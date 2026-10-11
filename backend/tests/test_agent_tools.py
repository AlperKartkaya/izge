from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import SecretStr

from app.models.domain import User
from app.services.agent_tools import (
    AgentToolError,
    _validated_endpoint_url,
    available_mcp_tools,
    run_mcp_tool,
    run_web_search,
    source_visible_to_reader,
)


SCHEMA = {
    "type": "object",
    "properties": {"ticket": {"type": "string", "minLength": 2, "maxLength": 20}},
    "required": ["ticket"],
    "additionalProperties": False,
}


def settings(connectors: list[dict] | None = None, *, web_key: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        agent_mcp_connectors_json=json.dumps(connectors or []),
        agent_web_search_key=SecretStr(web_key or ""),
    )


def connector(url: str = "https://mcp.example.com/rpc") -> dict:
    return {
        "id": "support",
        "url": url,
        "workspace_id": "ws-1",
        "allowed_user_ids": ["user-1", "user-2"],
        "tools": [{"name": "ticket_status", "description": "  Read\n ticket status  ", "input_schema": SCHEMA}],
    }


class _MCPHandler(BaseHTTPRequestHandler):
    calls: list[tuple[str, dict, str | None, str | None]] = []
    fail_tool = False
    bad_protocol = False
    missing_tools_capability = False

    def log_message(self, format: str, *args: object) -> None:
        pass

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).calls.append(
            (body["method"], body, self.headers.get("Mcp-Session-Id"), self.headers.get("MCP-Protocol-Version"))
        )
        method = body["method"]
        if method == "notifications/initialized":
            self.send_response(202)
            self.end_headers()
            return
        if method == "initialize":
            result = {
                "protocolVersion": "2024-11-05" if self.bad_protocol else "2025-06-18",
                "capabilities": {} if self.missing_tools_capability else {"tools": {}},
                "serverInfo": {"name": "fake"},
            }
            self._json(body["id"], result, session="session-1")
        elif method == "tools/list":
            payload = json.dumps(
                {"jsonrpc": "2.0", "id": body["id"], "result": {"tools": [{"name": "ticket_status"}]}}
            ).encode()
            wire = b"event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n" + b"data: " + payload + b"\n\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(wire)))
            self.end_headers()
            self.wfile.write(wire)
        elif method == "tools/call":
            result = {"isError": self.fail_tool, "content": [{"type": "text", "text": "Ticket AC-42 açık"}]}
            self._json(body["id"], result)

    def _json(self, request_id: int, result: dict, *, session: str | None = None) -> None:
        wire = json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(wire)))
        if session:
            self.send_header("Mcp-Session-Id", session)
        self.end_headers()
        self.wfile.write(wire)


class AgentToolTests(unittest.TestCase):
    def setUp(self) -> None:
        _MCPHandler.calls = []
        _MCPHandler.fail_tool = False
        _MCPHandler.bad_protocol = False
        _MCPHandler.missing_tools_capability = False

    @patch("app.services.agent_tools.get_settings")
    def test_available_tools_are_explicit_and_permission_scoped(self, mocked_settings) -> None:
        mocked_settings.return_value = settings([connector()])
        self.assertEqual(available_mcp_tools("ws-1", ["user-1"]), [{
            "connector_id": "support",
            "name": "ticket_status",
            "description": "Read ticket status",
            "input_schema": SCHEMA,
        }])
        self.assertEqual(available_mcp_tools("other", ["user-1"]), [])
        self.assertEqual(available_mcp_tools("ws-1", ["outsider"]), [])

    @patch("app.services.agent_tools.get_settings")
    def test_malformed_configuration_and_unsupported_schema_fail_closed(self, mocked_settings) -> None:
        mocked_settings.return_value = SimpleNamespace(agent_mcp_connectors_json="not-json")
        with self.assertRaisesRegex(AgentToolError, "invalid JSON"):
            available_mcp_tools("ws-1", ["user-1"])
        bad = connector()
        bad["tools"][0]["input_schema"] = {"type": "object", "oneOf": []}
        mocked_settings.return_value = settings([bad])
        with self.assertRaisesRegex(AgentToolError, "unsupported rules"):
            available_mcp_tools("ws-1", ["user-1"])
        mocked_settings.return_value = settings([connector(), connector()])
        with self.assertRaisesRegex(AgentToolError, "identifiers must be unique"):
            available_mcp_tools("ws-1", ["user-1"])

    def test_mcp_endpoint_policy_allows_operator_configured_internal_hosts(self) -> None:
        self.assertEqual(_validated_endpoint_url("http://127.0.0.1:8123/mcp"), "http://127.0.0.1:8123/mcp")
        self.assertEqual(_validated_endpoint_url("http://10.10.0.8/mcp"), "http://10.10.0.8/mcp")
        self.assertEqual(_validated_endpoint_url("https://tools.company.internal/mcp"), "https://tools.company.internal/mcp")
        for url in (
            "http://user:secret@tools.company.internal/mcp",
            "http://tools.company.internal/mcp#fragment",
            "http://169.254.169.254/latest/meta-data",
            "http://224.0.0.1/mcp",
            "http://0.0.0.0/mcp",
            "http://metadata.google.internal/computeMetadata/v1",
        ):
            with self.subTest(url=url), self.assertRaises(AgentToolError):
                _validated_endpoint_url(url)

    @patch("app.services.agent_tools._request_json")
    @patch("app.services.agent_tools._is_public_url", return_value=True)
    @patch("app.services.agent_tools.get_settings")
    def test_web_search_returns_bounded_sources_without_exposing_key(self, mocked_settings, _safe_url, request) -> None:
        mocked_settings.return_value = settings(web_key="brave-secret")
        request.return_value = {"web": {"results": [
            {"title": " Result  one ", "url": f"https://example.com/{index}", "description": "Snippet"}
            for index in range(7)
        ]}}
        results = run_web_search("  support   issue ")
        self.assertEqual(len(results), 5)
        self.assertEqual(results[0]["source_type"], "web")
        self.assertTrue(results[0]["artifact_id"].startswith("web:"))
        self.assertEqual(request.call_args.kwargs["headers"]["X-Subscription-Token"], "brave-secret")
        self.assertNotIn("brave-secret", json.dumps(results))

    @patch("app.services.agent_tools.get_settings", return_value=settings())
    def test_web_search_requires_configuration(self, _settings) -> None:
        with self.assertRaisesRegex(AgentToolError, "not configured"):
            run_web_search("status")

    @patch("app.services.agent_tools.get_settings")
    def test_mcp_runs_real_protocol_sequence_and_keeps_session(self, mocked_settings) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _MCPHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            mocked_settings.return_value = settings([connector(f"http://127.0.0.1:{server.server_port}/mcp")])
            source = run_mcp_tool(
                "support", "ticket_status", {"ticket": "AC-42"}, workspace_id="ws-1", reader_ids=["user-1"]
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual([call[0] for call in _MCPHandler.calls], [
            "initialize", "notifications/initialized", "tools/list", "tools/call"
        ])
        self.assertIsNone(_MCPHandler.calls[0][2])
        self.assertIsNone(_MCPHandler.calls[0][3])
        self.assertEqual([call[2] for call in _MCPHandler.calls[1:]], ["session-1"] * 3)
        self.assertEqual([call[3] for call in _MCPHandler.calls[1:]], ["2025-06-18"] * 3)
        self.assertEqual(source["source_type"], "mcp")
        self.assertIn("AC-42", source["quote"])

    @patch("app.services.agent_tools.get_settings")
    def test_mcp_denies_unknown_user_tool_and_invalid_arguments_before_network(self, mocked_settings) -> None:
        mocked_settings.return_value = settings([connector()])
        with self.assertRaisesRegex(AgentToolError, "not available"):
            run_mcp_tool("support", "ticket_status", {"ticket": "AC-42"}, workspace_id="ws-1", reader_ids=["x"])
        with self.assertRaisesRegex(AgentToolError, "not explicitly allowed"):
            run_mcp_tool("support", "delete_ticket", {}, workspace_id="ws-1", reader_ids=["user-1"])
        with self.assertRaisesRegex(AgentToolError, "unknown field"):
            run_mcp_tool(
                "support", "ticket_status", {"ticket": "AC-42", "admin": True}, workspace_id="ws-1", reader_ids=["user-1"]
            )

    @patch("app.services.agent_tools.get_settings")
    def test_mcp_tool_error_is_not_returned_as_a_source(self, mocked_settings) -> None:
        _MCPHandler.fail_tool = True
        server = ThreadingHTTPServer(("127.0.0.1", 0), _MCPHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        mocked_settings.return_value = settings([connector(f"http://127.0.0.1:{server.server_port}/mcp")])
        try:
            with self.assertRaisesRegex(AgentToolError, "reported an error"):
                run_mcp_tool(
                    "support", "ticket_status", {"ticket": "AC-42"}, workspace_id="ws-1", reader_ids=["user-1"]
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    @patch("app.services.agent_tools.get_settings")
    def test_mcp_rejects_malformed_protocol_negotiation(self, mocked_settings) -> None:
        _MCPHandler.bad_protocol = True
        server = ThreadingHTTPServer(("127.0.0.1", 0), _MCPHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        mocked_settings.return_value = settings([connector(f"http://127.0.0.1:{server.server_port}/mcp")])
        try:
            with self.assertRaisesRegex(AgentToolError, "unsupported protocol"):
                run_mcp_tool(
                    "support", "ticket_status", {"ticket": "AC-42"}, workspace_id="ws-1", reader_ids=["user-1"]
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    @patch("app.services.agent_tools.get_settings")
    def test_mcp_requires_tools_capability_before_listing_or_calling(self, mocked_settings) -> None:
        _MCPHandler.missing_tools_capability = True
        server = ThreadingHTTPServer(("127.0.0.1", 0), _MCPHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        mocked_settings.return_value = settings([connector(f"http://127.0.0.1:{server.server_port}/mcp")])
        try:
            with self.assertRaisesRegex(AgentToolError, "unsupported protocol"):
                run_mcp_tool(
                    "support", "ticket_status", {"ticket": "AC-42"}, workspace_id="ws-1", reader_ids=["user-1"]
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual([call[0] for call in _MCPHandler.calls], ["initialize"])

    @patch("app.services.agent_tools._is_public_url", side_effect=lambda url: url.startswith("https://public.example"))
    @patch("app.services.agent_tools.get_settings")
    def test_source_visibility_rechecks_current_connector_access(self, mocked_settings, _safe_url) -> None:
        mocked_settings.return_value = settings([connector()])
        reader = User(
            user_id="user-1",
            workspace_id="ws-1",
            role="employee",
            display_name="User One",
            email="one@example.com",
            password_hash="unused",
        )
        self.assertTrue(source_visible_to_reader({"source_type": "web", "url": "https://public.example/a"}, reader))
        self.assertFalse(source_visible_to_reader({"source_type": "web", "url": "http://127.0.0.1/a"}, reader))
        self.assertTrue(source_visible_to_reader({"source_type": "mcp", "connector_id": "support"}, reader))
        revoked = connector()
        revoked["allowed_user_ids"] = ["user-2"]
        mocked_settings.return_value = settings([revoked])
        self.assertFalse(source_visible_to_reader({"source_type": "mcp", "connector_id": "support"}, reader))
        mocked_settings.return_value = settings([connector()])
        reader.workspace_id = "other"
        self.assertFalse(source_visible_to_reader({"source_type": "mcp", "connector_id": "support"}, reader))


if __name__ == "__main__":
    unittest.main()
