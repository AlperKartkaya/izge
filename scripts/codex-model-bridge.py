#!/usr/bin/env python3
"""Keep Codex OAuth credentials on the host while proxying Responses SSE."""

from __future__ import annotations

import base64
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


UPSTREAM = "https://chatgpt.com/backend-api/codex"
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class BridgeError(RuntimeError):
    pass


def _auth_path() -> Path:
    return Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser() / "auth.json"


def _jwt_exp(token: str) -> int | None:
    try:
        encoded = token.split(".")[1]
        encoded += "=" * (-len(encoded) % 4)
        return json.loads(base64.urlsafe_b64decode(encoded))["exp"]
    except (IndexError, KeyError, ValueError, json.JSONDecodeError):
        return None


def borrow_codex_key() -> tuple[str, str | None]:
    path = _auth_path()
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise BridgeError("Codex auth.json is unavailable; run `codex login`") from exc
    if data.get("auth_mode") != "chatgpt":
        raise BridgeError("Codex login must use ChatGPT authentication")
    tokens = data.get("tokens") or {}
    access_token = tokens.get("access_token")
    if not isinstance(access_token, str):
        raise BridgeError("Codex access token is missing; run `codex login`")
    expiry = _jwt_exp(access_token)
    if expiry is not None and time.time() >= expiry - 30:
        raise BridgeError("Codex access token expired; let Codex refresh it or run `codex login`")
    return access_token, tokens.get("account_id")


def _valid_payload(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    allowed_fields = {
        "model",
        "input",
        "instructions",
        "store",
        "stream",
        "max_output_tokens",
        "reasoning",
        "text",
    }
    max_output_tokens = payload.get("max_output_tokens")
    reasoning = payload.get("reasoning")
    return (
        not (set(payload) - allowed_fields)
        and payload.get("model") == "gpt-6-luna"
        and payload.get("stream") is True
        and payload.get("store") is False
        and isinstance(payload.get("input"), list)
        and (payload.get("instructions") is None or isinstance(payload.get("instructions"), str))
        and isinstance(max_output_tokens, int)
        and not isinstance(max_output_tokens, bool)
        and 1 <= max_output_tokens <= 8192
        and (
            reasoning is None
            or isinstance(reasoning, dict)
            and set(reasoning) == {"effort"}
            and reasoning.get("effort") in {"none", "low", "medium", "high", "xhigh", "max"}
        )
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/responses":
            self._error(404, "Not found")
            return
        expected = os.environ.get("CODEX_BRIDGE_TOKEN")
        supplied = self.headers.get("Authorization", "")
        if expected and not hmac.compare_digest(supplied, f"Bearer {expected}"):
            self._error(401, "Unauthorized")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._error(400, "Invalid content length")
            return
        if size <= 0 or size > MAX_REQUEST_BYTES:
            self._error(413, "Request body is empty or too large")
            return
        body = self.rfile.read(size)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._error(400, "Request body must be JSON")
            return
        if not _valid_payload(payload):
            self._error(400, "Bridge accepts only streaming gpt-6-luna requests")
            return
        try:
            access_token, account_id = borrow_codex_key()
            headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
            if account_id:
                headers["ChatGPT-Account-ID"] = account_id
            request = urllib.request.Request(f"{UPSTREAM}/responses", data=body, headers=headers)
            upstream = urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as exc:
            self._error(502, f"Codex upstream returned HTTP {exc.code}")
            return
        except (OSError, BridgeError) as exc:
            self._error(502, str(exc))
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            while chunk := upstream.readline():
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            upstream.close()
            self.close_connection = True

    def _error(self, status: int, message: str) -> None:
        body = json.dumps({"error": message}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    host = os.environ.get("CODEX_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("CODEX_BRIDGE_PORT", "8766"))
    token = os.environ.get("CODEX_BRIDGE_TOKEN", "")
    if host not in {"127.0.0.1", "::1", "localhost"} and len(token) < 32:
        raise SystemExit("A CODEX_BRIDGE_TOKEN of at least 32 characters is required outside loopback")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Codex model bridge listening on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
