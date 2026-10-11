import io
import json
import runpy
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from pydantic import SecretStr

from app.config import Settings
from app.services.agent_model import (
    AgentModelError,
    _sse_data,
    _stream_chat_completions,
    _stream_ollama,
    model_catalog,
    model_session,
    resolve_effective_model_options,
    stream_agent_text,
    structured_agent_output,
)


class AgentModelTests(unittest.TestCase):
    def test_codex_bridge_rejects_unexpected_fields_and_malformed_payloads(self) -> None:
        bridge = runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts" / "codex-model-bridge.py"))
        valid_payload = bridge["_valid_payload"]
        payload = {
            "model": "gpt-6-luna",
            "input": [{"role": "user", "content": "test"}],
            "instructions": "test",
            "store": False,
            "stream": True,
            "max_output_tokens": 16,
            "reasoning": {"effort": "none"},
        }
        self.assertTrue(valid_payload(payload))
        self.assertFalse(valid_payload([]))
        self.assertFalse(valid_payload({**payload, "tools": []}))
        self.assertFalse(valid_payload({**payload, "reasoning": {"effort": "unsupported"}}))

    @patch("app.services.agent_model.get_settings")
    def test_catalog_never_exposes_credentials_or_urls(self, mocked_settings) -> None:
        mocked_settings.return_value = Settings.model_construct(
            local_llm_enabled=True,
            agent_glm_api_key=SecretStr("glm-secret"),
            agent_deepseek_api_key=SecretStr("deepseek-secret"),
            agent_codex_bridge_base_url="http://127.0.0.1:8766",
            agent_codex_bridge_token=SecretStr("bridge-secret"),
        )
        catalog = model_catalog()
        serialized = json.dumps(catalog)
        self.assertEqual(catalog["default_profile"], "ollama")
        self.assertNotIn("secret", serialized)
        self.assertNotIn("127.0.0.1", serialized)
        self.assertIn("glm-5.3-flash", serialized)
        self.assertIn("deepseek-flash", serialized)
        self.assertIn("gpt-6-luna", serialized)

    @patch("app.services.agent_model.get_settings")
    def test_blank_provider_env_values_are_not_configured(self, mocked_settings) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_glm_api_key=SecretStr("  "),
            agent_deepseek_api_key=SecretStr(""),
            agent_codex_bridge_base_url=" ",
            agent_codex_bridge_token=SecretStr(""),
        )
        profiles = {item["id"]: item for item in model_catalog()["profiles"]}
        self.assertFalse(profiles["glm"]["enabled"])
        self.assertFalse(profiles["deepseek"]["enabled"])
        self.assertFalse(profiles["codex"]["enabled"])
        with model_session("glm", "low"), self.assertRaisesRegex(AgentModelError, "API key"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=10))
        with model_session("codex", "low"), self.assertRaisesRegex(AgentModelError, "URL and token"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=10))

    def test_sse_parser_collects_multiline_events(self) -> None:
        response = io.BytesIO(b": ping\n\ndata: {\"type\":\ndata: \"response.completed\"}\n\n")
        self.assertEqual(list(_sse_data(response)), ['{"type":\n"response.completed"}'])

    @patch("app.services.agent_model._open_request")
    def test_chat_stream_rejects_eof_without_done(self, mocked_open) -> None:
        connection = Mock()
        mocked_open.return_value = (
            connection,
            io.BytesIO(b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        )
        with self.assertRaisesRegex(AgentModelError, "before completion"):
            list(_stream_chat_completions("https://example.test", {}, {}, 5))
        connection.close.assert_called_once()

    @patch("app.services.agent_model._open_request")
    def test_public_ollama_url_uses_existing_allow_flag(self, mocked_open) -> None:
        connection = Mock()
        mocked_open.return_value = (connection, io.BytesIO(b'{"message":{"content":"ok"},"done":true}\n'))
        self.assertEqual(
            list(_stream_ollama("https://ollama.example", {}, 5, allow_public=True)),
            ["ok"],
        )
        connection.close.assert_called_once()
        with self.assertRaisesRegex(AgentModelError, "private/internal"):
            list(_stream_ollama("https://ollama.example", {}, 5))

    @patch("app.services.agent_model._stream_ollama")
    @patch("app.services.agent_model.get_settings")
    def test_model_session_is_scoped_and_ollama_keeps_safe_options(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(local_llm_enabled=True, agent_model_effort="none")
        mocked_stream.return_value = iter(["merhaba"])
        with model_session("ollama", "none"):
            self.assertEqual(
                list(stream_agent_text([{"role": "user", "content": "Merhaba"}], max_tokens=20)), ["merhaba"]
            )
        payload = mocked_stream.call_args.args[1]
        self.assertEqual(payload["options"]["num_ctx"], 8192)
        self.assertIs(payload["think"], False)

    @patch("app.services.agent_model.stream_agent_text", return_value=iter(['{"answer":"tamam"}']))
    def test_structured_output_validates_required_fields(self, _mocked_stream) -> None:
        schema = {
            "type": "object",
            "required": ["answer"],
            "properties": {"answer": {"type": "string"}},
        }
        self.assertEqual(structured_agent_output("s", "u", schema, 50), {"answer": "tamam"})

    @patch("app.services.agent_model.stream_agent_text", return_value=iter(["{}"] ))
    def test_structured_output_rejects_missing_required_field(self, _mocked_stream) -> None:
        schema = {"type": "object", "required": ["answer"], "properties": {"answer": {"type": "string"}}}
        with self.assertRaisesRegex(AgentModelError, "missing required field"):
            structured_agent_output("s", "u", schema, 50)

    @patch("app.services.agent_model.get_settings")
    def test_unsupported_effort_is_not_silently_mapped(self, mocked_settings) -> None:
        mocked_settings.return_value = Settings.model_construct(local_llm_enabled=True)
        with model_session("glm", "medium"), self.assertRaisesRegex(AgentModelError, "not supported"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=10))

    @patch("app.services.agent_model._stream_chat_completions", return_value=iter(["yanıt"]))
    @patch("app.services.agent_model.get_settings")
    def test_glm_uses_exact_model_endpoint_and_effort(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(agent_glm_api_key=SecretStr("key"))
        with model_session("glm", "high"):
            self.assertEqual(
                list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=12)), ["yanıt"]
            )
        self.assertEqual(mocked_stream.call_args.args[0], "https://api.z.ai/api/paas/v4")
        payload = mocked_stream.call_args.args[1]
        self.assertEqual(payload["model"], "glm-5.3-flash")
        self.assertEqual(payload["reasoning_effort"], "high")

    @patch("app.services.agent_model._stream_responses", return_value=iter(["yanıt"]))
    @patch("app.services.agent_model.get_settings")
    def test_codex_uses_exact_model_and_selected_effort(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_codex_bridge_base_url="http://127.0.0.1:8766",
            agent_codex_bridge_token=SecretStr("bridge-key"),
        )
        with model_session("codex", "max"):
            self.assertEqual(
                list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=12)), ["yanıt"]
            )
        payload = mocked_stream.call_args.args[1]
        self.assertEqual(payload["model"], "gpt-6-luna")
        self.assertEqual(payload["reasoning"], {"effort": "max"})
        self.assertEqual(mocked_stream.call_args.args[2]["Authorization"], "Bearer bridge-key")

    @patch("app.services.agent_model._stream_responses", return_value=iter(['{"ok":true}']))
    @patch("app.services.agent_model.get_settings")
    def test_codex_schema_uses_json_object_mode_without_mutating_business_schema(
        self, mocked_settings, mocked_stream
    ) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_codex_bridge_base_url="http://127.0.0.1:8766",
            agent_codex_bridge_token=SecretStr("bridge-key"),
        )
        schema = {
            "type": "object",
            "properties": {"arguments": {"type": "object"}},
            "required": ["arguments"],
        }
        original_schema = json.loads(json.dumps(schema))
        with model_session("codex", "low"):
            list(
                stream_agent_text(
                    [{"role": "user", "content": "Planla"}],
                    max_tokens=128,
                    schema=schema,
                )
            )
        payload = mocked_stream.call_args.args[1]
        self.assertEqual(payload["text"], {"format": {"type": "json_object"}})
        self.assertIn(json.dumps(schema, sort_keys=True), payload["input"][-1]["content"])
        self.assertEqual(schema, original_schema)

    @patch("app.services.agent_model._stream_responses", return_value=iter(["yanıt"]))
    @patch("app.services.agent_model.get_settings")
    def test_codex_none_is_sent_explicitly(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_codex_bridge_base_url="http://127.0.0.1:8766",
            agent_model_effort="none",
            agent_codex_bridge_token=SecretStr("bridge-key"),
        )
        with model_session("codex", "none"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=12))
        self.assertEqual(mocked_stream.call_args.args[1]["reasoning"], {"effort": "none"})

    @patch("app.services.agent_model._stream_responses", return_value=iter(["yanıt"]))
    @patch("app.services.agent_model.get_settings")
    def test_codex_uses_profile_default_when_switching_provider(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_codex_bridge_base_url="http://127.0.0.1:8766",
            agent_model_provider="ollama",
            agent_model_effort="none",
            agent_codex_bridge_token=SecretStr("bridge-key"),
        )
        with model_session("codex"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=12))
        self.assertEqual(mocked_stream.call_args.args[1]["reasoning"], {"effort": "medium"})

    @patch("app.services.agent_model.get_settings")
    def test_effective_options_do_not_inherit_another_profiles_effort(self, mocked_settings) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_model_provider="codex",
            agent_model_effort="high",
        )
        self.assertEqual(
            resolve_effective_model_options("glm"),
            {"model_profile": "glm", "reasoning_effort": "low"},
        )
        self.assertEqual(
            resolve_effective_model_options(),
            {"model_profile": "codex", "reasoning_effort": "high"},
        )

    @patch("app.services.agent_model.get_settings")
    def test_effective_options_validate_explicit_effort_for_profile(self, mocked_settings) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_model_provider="ollama",
            agent_model_effort="none",
        )
        with self.assertRaisesRegex(AgentModelError, "not supported"):
            resolve_effective_model_options("glm", "medium")

    @patch("app.services.agent_model._stream_chat_completions", return_value=iter(["yanıt"]))
    @patch("app.services.agent_model.get_settings")
    def test_glm_uses_low_when_global_default_is_unsupported(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(
            agent_glm_api_key=SecretStr("key"),
            agent_model_effort="none",
        )
        with model_session("glm"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=12))
        self.assertEqual(mocked_stream.call_args.args[1]["reasoning_effort"], "low")

    @patch("app.services.agent_model._stream_chat_completions", return_value=iter(["yanıt"]))
    @patch("app.services.agent_model.get_settings")
    def test_deepseek_none_is_sent_explicitly(self, mocked_settings, mocked_stream) -> None:
        mocked_settings.return_value = Settings.model_construct(agent_deepseek_api_key=SecretStr("key"))
        with model_session("deepseek", "none"):
            list(stream_agent_text([{"role": "user", "content": "test"}], max_tokens=12))
        payload = mocked_stream.call_args.args[1]
        self.assertEqual(payload["model"], "deepseek-flash")
        self.assertEqual(payload["reasoning_effort"], "none")


if __name__ == "__main__":
    unittest.main()
