from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any, cast
import urllib.error
import urllib.request


BASE = os.environ.get("IZGE_EVAL_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
REPO_ROOT = Path(__file__).resolve().parents[2]
ADMIN_CREDENTIALS = Path(
    os.environ.get(
        "IZGE_EVAL_ADMIN_CREDENTIALS_PATH",
        REPO_ROOT / "backend" / "data" / "bootstrap_admin_credentials.json",
    )
).expanduser()
STATE_DIR = Path.home() / ".local" / "share" / "izge"
DEMO_CREDENTIALS = STATE_DIR / "demo-credentials.json"
REPORT_PATH = STATE_DIR / "turkish-colleague-smoke-report.json"

DENIZ_EMAIL = "deniz.demo@izge.local"
ECE_EMAIL = "ece.demo@izge.local"
PLAN_TITLE = "Mavi Pilot Ürün Planı — 7 Ekim 2026"
LOG_TITLE = "Mavi Pilot Günlük Log — 8 Ekim 2026"
TASK_TITLE = "Mavi pilot destek kapasitesi geçişini doğrula"
THREAD_ID = "group:mavi-pilot-smoke"
PRIVATE_THREAD_ID = "direct:deniz-izge-smoke"
PRIVATE_MARKER = "MAVI-PRIVATE-SMOKE-NOTU"
CLIENT_REQUEST_ID = f"turkish-colleague-smoke-{secrets.token_hex(8)}"

PLAN_TEXT = """# Mavi Pilot Ürün Planı

Kayıt zamanı: 2026-10-07T09:00:00Z

## Karar
Mavi pilotunda haftalık destek kapasitesi 25 taleptir.

## Varsayım
İlk pilot haftasında 25 talebin ekip kapasitesini aşmayacağı varsayılıyor.

## Takip
Kapasite kararı ertesi günün operasyon günlüğünde yeniden değerlendirilecek.
"""

LOG_TEXT = """# Mavi Pilot Günlük Log

Kayıt zamanı: 2026-10-08T16:30:00Z

## Güncel değişiklik
Mavi pilotunun haftalık destek kapasitesi 25 talepten 40 talebe çıkarıldı. Bu kayıt önceki 25 taleplik kararın yerine geçer; güncel kapasite 40 taleptir.

## Gerekçe
Pilot kapsamına yeni müşteriler eklendiği için destek vardiyası genişletildi.

## Takip
MAVI-104 bileti kapsamında Deniz, kapasite geçişini ve ilk hafta yükünü kontrol edecek.
"""


def utc_now() -> datetime:
    return datetime.now(UTC)


def json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def request(
    path: str,
    *,
    method: str = "GET",
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float = 30,
) -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json_bytes(payload)
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} HTTP {exc.code}: {detail}") from exc
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def request_status(path: str, *, token: str | None = None, timeout: float = 30) -> tuple[int, bytes]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    req = urllib.request.Request(BASE + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def expect_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AssertionError(f"{label}: nesne bekleniyordu")
    return cast(dict[str, Any], value)


def expect_list(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise AssertionError(f"{label}: nesne listesi bekleniyordu")
    return cast(list[dict[str, Any]], value)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read_credentials(path: Path) -> dict[str, str]:
    payload = expect_dict(json.loads(path.read_text(encoding="utf-8")), str(path))
    email, password = payload.get("email"), payload.get("password")
    require(isinstance(email, str) and isinstance(password, str), f"Geçersiz kimlik dosyası: {path}")
    return {"email": str(email), "password": str(password)}


def write_private_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)


def sign_in(credentials: dict[str, str]) -> tuple[str, dict[str, Any]]:
    response = expect_dict(request("/api/auth/sign-in", method="POST", payload=credentials), "oturum açma")
    token = response.get("access_token")
    require(isinstance(token, str) and bool(token), "Oturum açma erişim belirteci döndürmedi")
    return str(token), expect_dict(response.get("user"), "oturum kullanıcısı")


def ensure_demo_credentials() -> dict[str, dict[str, str]]:
    if DEMO_CREDENTIALS.exists():
        payload = expect_dict(json.loads(DEMO_CREDENTIALS.read_text(encoding="utf-8")), "demo kimlikleri")
        result: dict[str, dict[str, str]] = {}
        for key, email in (("deniz", DENIZ_EMAIL), ("ece", ECE_EMAIL)):
            credentials = expect_dict(payload.get(key), f"{key} kimliği")
            require(credentials.get("email") == email and isinstance(credentials.get("password"), str), f"{key} demo kimliği geçersiz")
            result[key] = {"email": email, "password": str(credentials["password"])}
        DEMO_CREDENTIALS.chmod(0o600)
        return result
    credentials = {
        "deniz": {"email": DENIZ_EMAIL, "password": secrets.token_urlsafe(18)},
        "ece": {"email": ECE_EMAIL, "password": secrets.token_urlsafe(18)},
    }
    write_private_json(DEMO_CREDENTIALS, credentials)
    return credentials


def ensure_users(admin_token: str, credentials: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    users = expect_list(request("/api/users", token=admin_token), "kullanıcı listesi")
    by_email = {str(user.get("email")): user for user in users}
    specs = (("deniz", "Deniz Yılmaz"), ("ece", "Ece Kaya"))
    result: dict[str, dict[str, Any]] = {}
    for key, display_name in specs:
        email = credentials[key]["email"]
        user = by_email.get(email)
        if user is None:
            user = expect_dict(
                request(
                    "/api/users",
                    method="POST",
                    token=admin_token,
                    payload={"display_name": display_name, "email": email, "role": "Member", "password": credentials[key]["password"], "is_active": True},
                ),
                f"{display_name} oluşturma",
            )
        require(user.get("role") == "Member" and user.get("is_active") is True, f"{display_name} aktif Member değil")
        result[key] = user
    return result


def ensure_artifact(admin_token: str, title: str, text: str) -> dict[str, Any]:
    artifacts = expect_list(request("/api/artifacts", token=admin_token), "dosya listesi")
    matches = [artifact for artifact in artifacts if artifact.get("title") == title]
    require(len(matches) <= 1, f"Aynı başlıklı birden fazla fixture var: {title}")
    artifact = matches[0] if matches else expect_dict(
        request(
            "/api/artifacts/pasted-text",
            method="POST",
            token=admin_token,
            payload={"title": title, "text": text, "visibility_scope": "workspace", "permitted_user_ids": []},
            timeout=180,
        ),
        f"{title} oluşturma",
    )
    detail = expect_dict(request(f"/api/artifacts/{artifact['artifact_id']}", token=admin_token), f"{title} detayı")
    require(detail.get("ingestion_status") == "completed", f"{title} işlenemedi: {detail.get('ingestion_status')}")
    expected_fragment = "25 talepten 40" if title == LOG_TITLE else "haftalık destek kapasitesi 25"
    require(expected_fragment in str(detail.get("extracted_text_preview") or ""), f"{title} beklenen fixture içeriğini taşımıyor")
    if detail.get("review_status") != "reviewed":
        detail = expect_dict(
            request(
                f"/api/artifacts/{artifact['artifact_id']}/review",
                method="PATCH",
                token=admin_token,
                payload={"review_status": "reviewed", "review_notes": "Türkçe çalışma arkadaşı demo fixture doğrulaması."},
            ),
            f"{title} güven incelemesi",
        )
    return detail


def ensure_task(admin_token: str, deniz_id: str, source_ids: list[str]) -> dict[str, Any]:
    items = expect_list(expect_dict(request("/api/work/tasks", token=admin_token), "iş listesi").get("items"), "işler")
    matches = [item for item in items if item.get("title") == TASK_TITLE]
    require(len(matches) <= 1, f"Aynı başlıklı birden fazla iş var: {TASK_TITLE}")
    if matches:
        task = matches[0]
        require(task.get("assignee_user_id") == deniz_id, "Mevcut smoke işi Deniz'e atanmamış")
        return task
    now = utc_now()
    return expect_dict(
        request(
            "/api/work/tasks",
            method="POST",
            token=admin_token,
            payload={
                "title": TASK_TITLE,
                "description": "MAVI-104: 25 talepten 40 talebe çıkan haftalık kapasitenin ilk hafta yükünü doğrula.",
                "assignee_user_id": deniz_id,
                "due_at": (now + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
                "remind_at": (now - timedelta(minutes=2)).isoformat().replace("+00:00", "Z"),
                "source_artifact_ids": source_ids,
            },
        ),
        "iş oluşturma",
    )


def chat_messages(token: str) -> list[dict[str, Any]]:
    return expect_list(expect_dict(request("/api/team-chat?limit=200", token=token), "takım sohbeti").get("messages"), "mesajlar")


def ensure_private_note(deniz_token: str, recipient_id: str) -> None:
    if any(message.get("body") == PRIVATE_MARKER for message in chat_messages(deniz_token)):
        return
    request(
        "/api/team-chat",
        method="POST",
        token=deniz_token,
        payload={
            "body": PRIVATE_MARKER,
            "thread_id": PRIVATE_THREAD_ID,
            "thread_title": "Deniz özel notu",
            "thread_kind": "direct",
            "message_metadata": {"participant_user_ids": [recipient_id]},
        },
    )


def reminder_count(token: str, task_id: str) -> int:
    return sum(
        1
        for message in chat_messages(token)
        if expect_dict(message.get("message_metadata") or {}, "mesaj metadata").get("source") == "izge-reminder"
        and expect_dict(message.get("message_metadata") or {}, "mesaj metadata").get("task_id") == task_id
    )


def wait_for_one_reminder(token: str, task_id: str, timeout_seconds: float = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        count = reminder_count(token, task_id)
        require(count <= 1, f"Hatırlatma birden fazla teslim edildi: {count}")
        if count == 1:
            break
        time.sleep(0.5)
    else:
        raise AssertionError("Hatırlatma süresi içinde teslim edilmedi")
    for _ in range(3):
        time.sleep(1.2)
        require(reminder_count(token, task_id) == 1, "Hatırlatma worker döngülerinde yinelendi")


def stream_events(token: str, run_id: str, timeout_seconds: float = 240) -> list[dict[str, Any]]:
    req = urllib.request.Request(
        f"{BASE}/api/work/runs/{run_id}/events?after_sequence=0",
        headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
    )
    events: list[dict[str, Any]] = []
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            event_type = "message"
            data_lines: list[str] = []
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    if data_lines:
                        payload = expect_dict(json.loads("\n".join(data_lines)), "SSE verisi")
                        payload.setdefault("event_type", event_type)
                        events.append(payload)
                        if event_type in {"done", "failed"}:
                            break
                    event_type, data_lines = "message", []
                elif line.startswith("event:"):
                    event_type = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data_lines.append(line.split(":", 1)[1].lstrip())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET work stream HTTP {exc.code}: {detail}") from exc
    require(events, "SSE akışı olay döndürmedi")
    require(events[-1].get("event_type") != "failed", f"Çalışma başarısız: {events[-1].get('text')}")
    return events


def ask_colleague(deniz_token: str, ece_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    requested_at = utc_now()
    accepted = expect_dict(
        request(
            "/api/work/ask",
            method="POST",
            token=deniz_token,
            payload={
                "message": "@İzge Mavi pilotunda haftalık destek kapasitesi önce kaç talepti, ertesi gün en son kaça çıkarıldı? Yalnızca şirket kayıtlarına dayan ve kaynak göster.",
                "client_request_id": CLIENT_REQUEST_ID,
                "thread_id": THREAD_ID,
                "thread_title": "Mavi Pilot Ekibi",
                "thread_kind": "group",
                "participant_user_ids": [ece_id],
            },
        ),
        "çalışma arkadaşı isteği",
    )
    events = stream_events(deniz_token, str(accepted["run_id"]))
    require(any(event.get("event_type") == "delta" and event.get("text") for event in events), "Gerçek streaming delta alınmadı")
    require(any(event.get("event_type") == "done" for event in events), "SSE done olayı alınmadı")
    require(any(event.get("event_type") == "source" for event in events), "SSE kaynak olayı alınmadı")
    run = expect_dict(request(f"/api/work/runs/{accepted['run_id']}", token=deniz_token), "çalışma sonucu")
    require(run.get("status") == "completed", f"Çalışma tamamlanmadı: {run.get('status')}")
    created_at = datetime.fromisoformat(str(run["created_at"]).replace("Z", "+00:00")).replace(tzinfo=UTC)
    require(created_at >= requested_at - timedelta(seconds=1), "Eski çalışma tekrar oynatıldı; yeni model isteği doğrulanmadı")
    return run, events


def assert_grounded_answer(run: dict[str, Any], artifact_ids: set[str], deniz_token: str) -> None:
    answer = str(run.get("answer") or "")
    sources = expect_list(run.get("sources"), "çalışma kaynakları")
    source_text = "\n".join(str(source.get("quote") or "") for source in sources)
    returned_ids = {str(source.get("artifact_id")) for source in sources}
    require(artifact_ids.issubset(returned_ids), "Yanıt iki Mavi pilot kaynağını da getirmedi")
    require("25" in source_text and "40" in source_text, "Kaynak alıntıları 25→40 değişikliğini kanıtlamıyor")
    require("25" in answer and "40" in answer and "[" in answer, "Yanıt 25→40 değişikliğini kaynak işaretiyle açıklamadı")
    require(any(word in answer.casefold() for word in ("güncel", "son", "çıkar")), "Yanıt 40'ın en son değer olduğunu belirtmedi")
    cited = next(source for source in sources if source.get("artifact_id") in artifact_ids and "40" in str(source.get("quote") or ""))
    artifact_id = str(cited["artifact_id"])
    detail = expect_dict(request(f"/api/artifacts/{artifact_id}", token=deniz_token), "alıntı kaynağı")
    require(detail.get("artifact_id") == artifact_id and detail.get("chunk_count", 0) > 0, "Alıntı kaynağı açılamadı")
    preview_status, preview = request_status(f"/api/artifacts/{artifact_id}/preview", token=deniz_token)
    require(preview_status == 200 and b"40" in preview, "Kaynak önizlemesi açılmadı veya alıntıyı içermiyor")


def assert_group_share(run_id: str, deniz_id: str, ece_token: str) -> None:
    messages = chat_messages(ece_token)
    related = [message for message in messages if expect_dict(message.get("message_metadata") or {}, "mesaj metadata").get("colleague_run_id") == run_id]
    require(any(message.get("author_user_id") == deniz_id and "@İzge" in str(message.get("body")) for message in related), "Ece grup içindeki insan sorusunu göremedi")
    require(any(expect_dict(message.get("message_metadata") or {}, "mesaj metadata").get("source") == "izge-colleague" and message.get("author_user_id") != deniz_id for message in related), "Ece İzge yanıtını göremedi")
    require(all(message.get("body") != PRIVATE_MARKER for message in messages), "Ece özel Deniz konuşmasını görebildi")


def run_evening_review(admin_token: str, artifact_ids: set[str]) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    accepted = expect_dict(request("/api/work/review", method="POST", token=admin_token), "gün sonu incelemesi")
    events = stream_events(admin_token, str(accepted["run_id"]), timeout_seconds=300)
    memory_events = [event for event in events if event.get("event_type") == "stage" and event.get("stage_key") == "memory_update"]
    require(any(event.get("status") == "completed" for event in memory_events), "Gün sonu hafıza güncelleme aşaması tamamlanmadı")
    require(any(event.get("event_type") == "delta" for event in events) and any(event.get("event_type") == "done" for event in events), "Gün sonu incelemesi gerçek model akışını tamamlamadı")
    run = expect_dict(request(f"/api/work/runs/{accepted['run_id']}", token=admin_token), "gün sonu sonucu")
    require(run.get("status") == "completed" and bool(run.get("answer")), "Gün sonu incelemesi tamamlanmış yanıt üretmedi")
    temporal_graph = expect_dict(request("/api/graph/temporal?limit=200", token=admin_token), "zamansal bilgi grafiği")
    graph_source_ids = {str(item.get("source_artifact_id")) for item in expect_list(temporal_graph.get("occurrences"), "grafik kayıtları")}
    require(artifact_ids.issubset(graph_source_ids), "Gün sonu sonrasında iki fixture bilgi grafiğinde bulunamadı")
    filesystem = expect_dict(request("/api/evidence-substrate/filesystem", token=admin_token), "kurumsal hafıza")
    memory_ids = {str(item.get("artifact_id")) for item in expect_list(filesystem.get("artifacts"), "hafıza dosyaları")}
    require(artifact_ids.issubset(memory_ids), "İki fixture kurumsal hafıza dosya sisteminde bulunamadı")
    return run, events, temporal_graph


def run_smoke() -> dict[str, Any]:
    health = expect_dict(request("/health"), "sağlık kontrolü")
    require(health.get("status") == "ok", "Uygulama sağlıklı değil")
    admin_token, admin_user = sign_in(read_credentials(ADMIN_CREDENTIALS))

    llm_status = expect_dict(request("/api/system/llm-status", token=admin_token), "LLM durumu")
    require(llm_status.get("gateway_status") == "ready", f"Ollama hazır değil: {llm_status.get('gateway_status')}")
    require(llm_status.get("configured_model") == "qwen3.5:9b" and llm_status.get("configured_model_available") is True, "Gerçek qwen3.5:9b modeli etkin değil")

    credentials = ensure_demo_credentials()
    users = ensure_users(admin_token, credentials)
    deniz_token, _ = sign_in(credentials["deniz"])
    ece_token, _ = sign_in(credentials["ece"])

    plan = ensure_artifact(admin_token, PLAN_TITLE, PLAN_TEXT)
    log = ensure_artifact(admin_token, LOG_TITLE, LOG_TEXT)
    artifact_ids = {str(plan["artifact_id"]), str(log["artifact_id"])}
    task = ensure_task(admin_token, str(users["deniz"]["user_id"]), sorted(artifact_ids))

    ensure_private_note(deniz_token, str(admin_user["user_id"]))
    require(all(message.get("body") != PRIVATE_MARKER for message in chat_messages(ece_token)), "Özel konuşma Ece'ye sızdı")
    wait_for_one_reminder(deniz_token, str(task["task_id"]))

    answer_run, answer_events = ask_colleague(deniz_token, str(users["ece"]["user_id"]))
    assert_grounded_answer(answer_run, artifact_ids, deniz_token)
    assert_group_share(str(answer_run["run_id"]), str(users["deniz"]["user_id"]), ece_token)

    review_run, review_events, graph = run_evening_review(admin_token, artifact_ids)
    return {
        "status": "passed",
        "base_url": BASE,
        "started_with_admin_user_id": admin_user.get("user_id"),
        "checked_at": utc_now().isoformat().replace("+00:00", "Z"),
        "llm": {"model": llm_status.get("configured_model"), "gateway_status": llm_status.get("gateway_status")},
        "users": {key: value.get("user_id") for key, value in users.items()},
        "artifact_ids": sorted(artifact_ids),
        "task_id": task.get("task_id"),
        "reminder_delivery_count": reminder_count(deniz_token, str(task["task_id"])),
        "answer_run": {"run_id": answer_run.get("run_id"), "status": answer_run.get("status"), "event_types": [event.get("event_type") for event in answer_events]},
        "review_run": {"run_id": review_run.get("run_id"), "status": review_run.get("status"), "event_types": [event.get("event_type") for event in review_events]},
        "temporal_graph": {"family_count": len(graph.get("families", [])), "occurrence_count": len(graph.get("occurrences", [])), "link_count": len(graph.get("links", []))},
        "checks": [
            "Turkish two-day plan/log fixture indexed",
            "qwen3.5:9b streamed grounded answer with openable source",
            "group answer visible to Ece and private note hidden",
            "reminder delivered exactly once",
            "manual evening review updated memory and temporal graph",
        ],
    }


def main() -> None:
    started_at = utc_now().isoformat().replace("+00:00", "Z")
    try:
        report = run_smoke()
    except Exception as exc:
        report = {"status": "failed", "base_url": BASE, "started_at": started_at, "finished_at": utc_now().isoformat().replace("+00:00", "Z"), "error": f"{type(exc).__name__}: {exc}"}
        write_private_json(REPORT_PATH, report)
        print(f"Türkçe çalışma arkadaşı smoke testi BAŞARISIZ. Rapor: {REPORT_PATH}")
        raise
    report["started_at"] = started_at
    report["finished_at"] = utc_now().isoformat().replace("+00:00", "Z")
    write_private_json(REPORT_PATH, report)
    print(f"Türkçe çalışma arkadaşı smoke testi BAŞARILI. Rapor: {REPORT_PATH}")


if __name__ == "__main__":
    main()
