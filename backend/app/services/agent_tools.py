from __future__ import annotations

import hashlib
import http.client
import ipaddress
import json
import os
import socket
from typing import Any
from urllib import parse

from app.config import get_settings
from app.models.domain import User


class AgentToolError(RuntimeError):
    pass


_MCP_VERSION = "2025-06-18"
_MAX_RESPONSE_BYTES = 1_000_000
_MAX_ARGUMENT_BYTES = 64_000
_SUPPORTED_SCHEMA_KEYS = {
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "const",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "description",
    "title",
}


def _safe_text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _is_public_url(value: str, *, resolve_dns: bool = True) -> bool:
    try:
        parsed = parse.urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if parsed.username or parsed.password or parsed.fragment:
            return False
        host = parsed.hostname.lower().rstrip(".")
        if host in {"localhost", "metadata.google.internal"} or host.endswith((".local", ".internal", ".lan")):
            return False
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            if not resolve_dns:
                return "." in host
            try:
                addresses = {ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, parsed.port or 443)}
            except (OSError, ValueError):
                return False
        return bool(addresses) and all(address.is_global for address in addresses)
    except ValueError:
        return False


def _validated_endpoint_url(value: str) -> str:
    try:
        parsed = parse.urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise AgentToolError("MCP connector URL must be an http(s) endpoint")
        if parsed.username or parsed.password or parsed.fragment:
            raise AgentToolError("MCP connector URL must not contain credentials or a fragment")
        host = parsed.hostname.lower().rstrip(".")
        if host == "metadata" or host == "instance-data" or host.startswith("metadata."):
            raise AgentToolError("MCP connector URL points to a cloud metadata host")
        try:
            addresses = {ipaddress.ip_address(host)}
        except ValueError:
            if host == "localhost" or host.endswith((".local", ".internal", ".lan")) or "." not in host:
                return value
            try:
                addresses = {ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, parsed.port or 443)}
            except (OSError, ValueError) as exc:
                raise AgentToolError("MCP connector hostname could not be resolved") from exc
        if any(
            address.is_link_local
            or address.is_multicast
            or address.is_unspecified
            or address.is_reserved
            for address in addresses
        ):
            raise AgentToolError("MCP connector URL points to a disallowed network address")
        return value
    except ValueError as exc:
        raise AgentToolError("MCP connector URL is invalid") from exc


def _validate_schema(schema: Any, *, depth: int = 0) -> None:
    if depth > 8 or not isinstance(schema, dict):
        raise AgentToolError("MCP tool input schema is invalid")
    if set(schema) - _SUPPORTED_SCHEMA_KEYS:
        raise AgentToolError("MCP tool input schema contains unsupported rules")
    schema_type = schema.get("type")
    if schema_type not in {"object", "array", "string", "number", "integer", "boolean", "null"}:
        raise AgentToolError("MCP tool input schema has an unsupported type")
    common_keys = {"type", "enum", "const", "description", "title"}
    type_keys = {
        "object": {"properties", "required", "additionalProperties"},
        "array": {"items", "minItems", "maxItems"},
        "string": {"minLength", "maxLength"},
        "number": {"minimum", "maximum"},
        "integer": {"minimum", "maximum"},
        "boolean": set(),
        "null": set(),
    }[schema_type]
    if set(schema) - common_keys - type_keys:
        raise AgentToolError("MCP tool input schema rule does not apply to its type")
    if any(key in schema and not isinstance(schema[key], str) for key in ("description", "title")):
        raise AgentToolError("MCP tool input schema labels are invalid")
    if "enum" in schema and (not isinstance(schema["enum"], list) or not schema["enum"]):
        raise AgentToolError("MCP tool input schema enum is invalid")
    if schema_type == "object":
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        additional = schema.get("additionalProperties", False)
        if not isinstance(properties, dict) or not all(isinstance(key, str) for key in properties):
            raise AgentToolError("MCP tool object properties are invalid")
        if not isinstance(required, list) or not all(isinstance(key, str) and key in properties for key in required):
            raise AgentToolError("MCP tool required properties are invalid")
        if not isinstance(additional, (bool, dict)):
            raise AgentToolError("MCP tool additional properties rule is invalid")
        for child in properties.values():
            _validate_schema(child, depth=depth + 1)
        if isinstance(additional, dict):
            _validate_schema(additional, depth=depth + 1)
    elif schema_type == "array":
        if "items" not in schema:
            raise AgentToolError("MCP tool array schema requires items")
        _validate_schema(schema["items"], depth=depth + 1)
        _validate_non_negative_bounds(schema, "minItems", "maxItems")
    elif schema_type == "string":
        _validate_non_negative_bounds(schema, "minLength", "maxLength")
    elif schema_type in {"number", "integer"}:
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if any(value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool)) for value in (minimum, maximum)):
            raise AgentToolError("MCP tool numeric bounds are invalid")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise AgentToolError("MCP tool numeric bounds are reversed")


def _validate_non_negative_bounds(schema: dict[str, Any], minimum_key: str, maximum_key: str) -> None:
    minimum = schema.get(minimum_key)
    maximum = schema.get(maximum_key)
    if any(value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0) for value in (minimum, maximum)):
        raise AgentToolError("MCP tool size bounds are invalid")
    if minimum is not None and maximum is not None and minimum > maximum:
        raise AgentToolError("MCP tool size bounds are reversed")


def _value_matches_type(value: Any, schema_type: str) -> bool:
    return {
        "null": value is None,
        "boolean": isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "string": isinstance(value, str),
        "array": isinstance(value, list),
        "object": isinstance(value, dict),
    }[schema_type]


def _validate_arguments(value: Any, schema: dict[str, Any], *, path: str = "arguments") -> None:
    schema_type = schema["type"]
    if not _value_matches_type(value, schema_type):
        raise AgentToolError(f"MCP tool {path} has the wrong type")
    if "enum" in schema and value not in schema["enum"]:
        raise AgentToolError(f"MCP tool {path} is outside the allowed values")
    if "const" in schema and value != schema["const"]:
        raise AgentToolError(f"MCP tool {path} does not match the required value")
    if schema_type == "string":
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", _MAX_ARGUMENT_BYTES):
            raise AgentToolError(f"MCP tool {path} has an invalid length")
    elif schema_type in {"number", "integer"}:
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            raise AgentToolError(f"MCP tool {path} is outside the allowed range")
    elif schema_type == "array":
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", 100):
            raise AgentToolError(f"MCP tool {path} has an invalid item count")
        for index, item in enumerate(value):
            _validate_arguments(item, schema["items"], path=f"{path}[{index}]")
    elif schema_type == "object":
        properties = schema.get("properties", {})
        missing = [key for key in schema.get("required", []) if key not in value]
        if missing:
            raise AgentToolError(f"MCP tool {path} is missing required fields")
        additional = schema.get("additionalProperties", False)
        for key, item in value.items():
            child_schema = properties.get(key)
            if child_schema is None:
                if additional is False:
                    raise AgentToolError(f"MCP tool {path} contains an unknown field")
                if additional is True:
                    continue
                child_schema = additional
            _validate_arguments(item, child_schema, path=f"{path}.{key}")


def _connectors() -> list[dict[str, Any]]:
    raw = getattr(get_settings(), "agent_mcp_connectors_json", "[]") or "[]"
    try:
        decoded = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise AgentToolError("MCP connector configuration is invalid JSON") from exc
    if not isinstance(decoded, list):
        raise AgentToolError("MCP connector configuration must be a list")
    connectors: list[dict[str, Any]] = []
    connector_ids: set[str] = set()
    allowed_fields = {"id", "url", "workspace_id", "allowed_user_ids", "tools", "token_env"}
    for item in decoded:
        if not isinstance(item, dict) or set(item) - allowed_fields:
            raise AgentToolError("MCP connector configuration contains unsupported fields")
        required = {"id", "url", "workspace_id", "allowed_user_ids", "tools"}
        if not required.issubset(item) or not all(isinstance(item[key], str) and item[key] for key in ("id", "url", "workspace_id")):
            raise AgentToolError("MCP connector configuration is incomplete")
        if item["id"] in connector_ids:
            raise AgentToolError("MCP connector identifiers must be unique")
        if not isinstance(item["allowed_user_ids"], list) or not item["allowed_user_ids"] or not all(
            isinstance(user_id, str) and user_id for user_id in item["allowed_user_ids"]
        ):
            raise AgentToolError("MCP connector allowed users must be a non-empty list")
        if "token_env" in item and (not isinstance(item["token_env"], str) or not item["token_env"]):
            raise AgentToolError("MCP connector token environment name is invalid")
        if not isinstance(item["tools"], list) or not item["tools"]:
            raise AgentToolError("MCP connector tools must be a non-empty list")
        names: set[str] = set()
        for tool in item["tools"]:
            if not isinstance(tool, dict) or set(tool) != {"name", "description", "input_schema"}:
                raise AgentToolError("MCP connector tool configuration is invalid")
            if not isinstance(tool["name"], str) or not tool["name"] or tool["name"] in names:
                raise AgentToolError("MCP connector tool name is invalid")
            if not isinstance(tool["description"], str):
                raise AgentToolError("MCP connector tool description is invalid")
            _validate_schema(tool["input_schema"])
            names.add(tool["name"])
        connectors.append(item)
        connector_ids.add(item["id"])
    return connectors


def _allowed_connectors(workspace_id: str, reader_ids: list[str]) -> list[dict[str, Any]]:
    readers = set(reader_ids)
    return [
        connector
        for connector in _connectors()
        if connector["workspace_id"] == workspace_id and readers and readers.issubset(set(connector["allowed_user_ids"]))
    ]


def available_mcp_tools(workspace_id: str, reader_ids: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "connector_id": connector["id"],
            "name": tool["name"],
            "description": _safe_text(tool["description"], 500),
            "input_schema": tool["input_schema"],
        }
        for connector in _allowed_connectors(workspace_id, reader_ids)
        for tool in connector["tools"]
    ]


def _read_response(response: http.client.HTTPResponse) -> bytes:
    content_length = response.getheader("Content-Length")
    if content_length:
        try:
            if int(content_length) > _MAX_RESPONSE_BYTES:
                raise AgentToolError("Tool response was too large")
        except ValueError as exc:
            raise AgentToolError("Tool provider returned an invalid content length") from exc
    body = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(body) > _MAX_RESPONSE_BYTES:
        raise AgentToolError("Tool response was too large")
    return body


def _request_json(url: str, *, headers: dict[str, str], timeout: int = 12) -> dict[str, Any]:
    parsed = parse.urlparse(url)
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    if parsed.hostname is None:
        raise AgentToolError("Tool provider URL is invalid")
    connection = connection_type(parsed.hostname, parsed.port, timeout=timeout)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        body = _read_response(response)
        if not 200 <= response.status < 300:
            raise AgentToolError(f"Tool provider returned HTTP {response.status}")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise AgentToolError("Tool provider returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise AgentToolError("Tool provider returned an invalid response")
        return payload
    except (OSError, TimeoutError) as exc:
        raise AgentToolError("Tool provider could not be reached") from exc
    finally:
        connection.close()


def run_web_search(query: str) -> list[dict[str, Any]]:
    query = " ".join(query.split())
    if not query or len(query) > 500:
        raise AgentToolError("Web search query must be between 1 and 500 characters")
    key = get_settings().agent_web_search_key.get_secret_value()
    if not key:
        raise AgentToolError("Web search is not configured")
    url = "https://api.search.brave.com/res/v1/web/search?" + parse.urlencode(
        {"q": query, "count": 5, "extra_snippets": "true"}
    )
    payload = _request_json(url, headers={"Accept": "application/json", "X-Subscription-Token": key})
    web = payload.get("web")
    results = web.get("results") if isinstance(web, dict) else None
    if not isinstance(results, list):
        return []
    sources: list[dict[str, Any]] = []
    for result in results[:5]:
        if not isinstance(result, dict) or not isinstance(result.get("url"), str) or not _is_public_url(result["url"]):
            continue
        title = _safe_text(result.get("title"), 300) or result["url"]
        quote = _safe_text(result.get("description"), 2_000)
        digest = hashlib.sha256(f"{query}\0{result['url']}".encode()).hexdigest()[:24]
        sources.append(
            {"artifact_id": f"web:{digest}", "title": title, "quote": quote, "source_type": "web", "url": result["url"]}
        )
    return sources


def _decode_mcp_response(body: bytes, content_type: str, request_id: int) -> dict[str, Any]:
    candidates: list[Any] = []
    text = body.decode("utf-8", errors="replace")
    if "text/event-stream" in content_type:
        for event in text.replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
            if data:
                try:
                    candidates.append(json.loads(data))
                except json.JSONDecodeError as exc:
                    raise AgentToolError("MCP server returned invalid SSE JSON") from exc
    else:
        try:
            candidates.append(json.loads(text))
        except json.JSONDecodeError as exc:
            raise AgentToolError("MCP server returned invalid JSON") from exc
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("id") == request_id:
            if "error" in candidate:
                raise AgentToolError("MCP server rejected the tool request")
            result = candidate.get("result")
            if isinstance(result, dict):
                return result
    raise AgentToolError("MCP server did not return the matching response")


class _MCPClient:
    def __init__(self, connector: dict[str, Any]) -> None:
        self.connector = connector
        self.url = _validated_endpoint_url(connector["url"])
        self.parsed = parse.urlparse(self.url)
        self.session_id: str | None = None
        self.protocol_version: str | None = None
        self.next_id = 1

    def _post(self, payload: dict[str, Any], *, notification: bool = False) -> dict[str, Any]:
        request_id = payload.get("id")
        body = json.dumps(payload, separators=(",", ":")).encode()
        token_env = self.connector.get("token_env")
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        if token_env:
            token = os.environ.get(token_env)
            if not token:
                raise AgentToolError("MCP connector credential is not configured")
            headers["Authorization"] = f"Bearer {token}"
        connection_type = http.client.HTTPSConnection if self.parsed.scheme == "https" else http.client.HTTPConnection
        if self.parsed.hostname is None:
            raise AgentToolError("MCP connector URL is invalid")
        connection = connection_type(self.parsed.hostname, self.parsed.port, timeout=12)
        path = self.parsed.path or "/"
        if self.parsed.query:
            path += f"?{self.parsed.query}"
        try:
            connection.request("POST", path, body=body, headers=headers)
            response = connection.getresponse()
            response_body = _read_response(response)
            if not 200 <= response.status < 300:
                raise AgentToolError(f"MCP server returned HTTP {response.status}")
            returned_session = response.getheader("Mcp-Session-Id")
            if returned_session and len(returned_session) <= 256:
                self.session_id = returned_session
            if notification:
                if response.status != 202 or response_body.strip():
                    raise AgentToolError("MCP server returned an invalid notification response")
                return {}
            if not isinstance(request_id, int):
                raise AgentToolError("MCP request identifier is invalid")
            return _decode_mcp_response(response_body, response.getheader("Content-Type") or "", request_id)
        except (OSError, TimeoutError) as exc:
            raise AgentToolError("MCP server could not be reached") from exc
        finally:
            connection.close()

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            payload["params"] = params
        return self._post(payload)

    def notify_initialized(self) -> None:
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, notification=True)


def run_mcp_tool(
    connector_id: str,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    workspace_id: str,
    reader_ids: list[str],
) -> dict[str, Any]:
    connector = next((item for item in _allowed_connectors(workspace_id, reader_ids) if item["id"] == connector_id), None)
    if connector is None:
        raise AgentToolError("MCP connector is not available to this conversation")
    tool = next((item for item in connector["tools"] if item["name"] == tool_name), None)
    if tool is None:
        raise AgentToolError("MCP tool is not explicitly allowed")
    if not isinstance(arguments, dict) or len(json.dumps(arguments).encode()) > _MAX_ARGUMENT_BYTES:
        raise AgentToolError("MCP tool arguments are invalid or too large")
    _validate_arguments(arguments, tool["input_schema"])

    client = _MCPClient(connector)
    initialized = client.request(
        "initialize",
        {"protocolVersion": _MCP_VERSION, "capabilities": {}, "clientInfo": {"name": "izge", "version": "1"}},
    )
    capabilities = initialized.get("capabilities")
    if (
        initialized.get("protocolVersion") != _MCP_VERSION
        or not isinstance(capabilities, dict)
        or not isinstance(capabilities.get("tools"), dict)
    ):
        raise AgentToolError("MCP server negotiated an unsupported protocol")
    client.protocol_version = _MCP_VERSION
    client.notify_initialized()
    listed = client.request("tools/list", {})
    server_tools = listed.get("tools")
    if not isinstance(server_tools, list) or not any(
        isinstance(server_tool, dict) and server_tool.get("name") == tool_name for server_tool in server_tools
    ):
        raise AgentToolError("MCP server did not advertise the allowed tool")
    result = client.request("tools/call", {"name": tool_name, "arguments": arguments})
    if result.get("isError") is True:
        raise AgentToolError("MCP tool reported an error")
    content = result.get("content")
    texts = [item.get("text") for item in content] if isinstance(content, list) else []
    quote = _safe_text("\n".join(text for text in texts if isinstance(text, str)), 8_000)
    if not quote:
        quote = _safe_text(json.dumps(result, ensure_ascii=False), 8_000)
    digest = hashlib.sha256(
        json.dumps([connector_id, tool_name, arguments], sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:24]
    return {
        "artifact_id": f"mcp:{digest}",
        "title": f"{connector_id}: {tool_name}",
        "quote": quote,
        "source_type": "mcp",
        "connector_id": connector_id,
    }


def source_visible_to_reader(source: dict[str, Any], reader: User) -> bool:
    if source.get("source_type") == "web":
        return isinstance(source.get("url"), str) and _is_public_url(source["url"])
    if source.get("source_type") != "mcp" or not isinstance(source.get("connector_id"), str):
        return False
    try:
        return any(
            connector["id"] == source["connector_id"]
            and connector["workspace_id"] == reader.workspace_id
            and reader.user_id in connector["allowed_user_ids"]
            for connector in _connectors()
        )
    except AgentToolError:
        return False
