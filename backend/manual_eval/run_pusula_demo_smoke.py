"""Real-LLM checks on an explicit disposable demo copy; never upload live files to the presentation."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import time
from urllib import parse, request
from uuid import uuid4


BASE = os.environ.get("IZGE_DEMO_QA_BASE_URL", "").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
STATE = Path.home() / ".local/share/izge"


def api(path, *, token=None, payload=None, method="GET", body=None, content_type=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        content_type = "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    with request.urlopen(request.Request(BASE + "/api" + path, data=body, headers=headers, method=method), timeout=180) as response:
        return json.load(response)


def await_run(token, run_id):
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        run = api(f"/work/runs/{run_id}", token=token)
        if run["status"] in {"completed", "failed"}:
            assert run["status"] == "completed", run.get("error")
            return run
        time.sleep(1)
    raise AssertionError(f"Çalışma zaman aşımı: {run_id}")


def ask(token, question, *, thread=None):
    accepted = api("/work/ask", token=token, method="POST", payload={
        "message": question, "client_request_id": str(uuid4()),
        "thread_id": thread or f"qa:{uuid4()}", "thread_title": "Demo kontrolü", "thread_kind": "direct",
    })
    return await_run(token, accepted["run_id"])


def upload(token, title, filename, content):
    boundary = f"pusula-{uuid4()}"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\n{title}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: text/markdown\r\n\r\n{content}\r\n--{boundary}--\r\n"
    ).encode()
    return api("/artifacts/upload", token=token, method="POST", body=body, content_type=f"multipart/form-data; boundary={boundary}")


def main():
    target = parse.urlparse(BASE)
    assert target.hostname in {"localhost", "127.0.0.1"} and target.port not in {None, 8080, 8081, 8000}, "Explicit disposable loopback API required, not the presentation app."
    credentials = json.loads(Path(os.environ["IZGE_DEMO_QA_CREDENTIALS_PATH"]).expanduser().read_text())
    if "users" in credentials:
        credentials = credentials["users"]
    deniz = credentials["deniz"]
    token = api("/auth/sign-in", method="POST", payload={"email": deniz["email"], "password": deniz["password"]})["access_token"]
    checks = []
    artifacts = api("/artifacts", token=token)
    assert not any("zeyilname-2" in (item.get("original_filename") or "") or "ticari-degisiklik" in (item.get("original_filename") or "") for item in artifacts)
    checks.append("live_files_absent_before_upload")
    notifications = api("/notifications", token=token)
    baseline = [item for item in notifications["items"] if item["kind"] == "agent" and item["read_at"] is None]
    assert baseline, "Actual LLM-generated unread baseline notification missing."
    alert = baseline[0]
    history = api("/work/runs?thread_id=" + parse.quote(alert["thread_id"]), token=token)["items"]
    assert any(item["run_id"] == alert["run_id"] and item["answer"] for item in history)
    checks.append("unread_alert_opens_persisted_conversation")
    results = []
    cases = [
        (1, "Atlas için faturalanmamış iş var mı? Sözleşme, teslim ve faturayı karşılaştır; tutarı hesapla.", r"36[.,\s]?000"),
        (2, "Atlas'ın Excel dışa aktarım talebinin sorumlusu veya ticket'ı var mı?", r"(?:yok|bulunma|kayıt|atanma)"),
        (3, "Atlas müşterisini kaybetme riski var mı? Destek geçmişini birleştir.", r"(?:yenile|kayıp|kaybet|risk)"),
        (5, "Atlas'ta tekrar eden zaman aşımının önceki müdahaleleri ve çözülmemiş kök nedeni ne?", r"(?:havuz|pool)"),
        (6, "Ece'nin Atlas staging erişimi neden bekliyor? Mert'e aktarılacak işi hazırla.", r"Mert"),
    ]
    for number, question, expected in cases:
        run = ask(token, question)
        assert run["sources"] and re.search(expected, run["answer"], re.IGNORECASE), (number, run["answer"])
        assert run["follow_ups"], (number, "Takip soruları üretilemedi")
        if number == 1:
            assert re.search(r"(?:onay|teyit|potansiyel)", run["answer"], re.IGNORECASE), run["answer"]
            assert "potansiyel" in run["answer"].casefold(), run["answer"]
            assert "kesinleşmiş alacak olarak" not in run["answer"].casefold(), run["answer"]
        if number == 5:
            assert re.search(r"(?:varsayım|hipotez|doğrulan|kesinleş|olabilir)", run["answer"], re.IGNORECASE), run["answer"]
        results.append({"case": number, "answer": run["answer"], "sources": run["sources"], "follow_ups": run["follow_ups"]})
        checks.append(f"case_{number}_real_llm")
        print(f"Use case {number}: gerçek yanıt, kaynaklar ve takip soruları geçti.", flush=True)

    file = ROOT / "docs/demo/live-upload/koru-ihale-zeyilname-2.md"
    added = upload(token, "Koru İhale Zeyilname 2", file.name, file.read_text())
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        reviews = api("/work/runs", token=token)["items"]
        review = next((run for run in reviews if run["kind"] == "artifact_review" and any(source["artifact_id"] == added["artifact_id"] for source in run["sources"])), None)
        if review and review["status"] in {"completed", "failed"}:
            assert review["status"] == "completed", review.get("error")
            break
        time.sleep(1)
    else:
        raise AssertionError("Live upload evaluation timed out")
    assert review["answer"] and "kvkk" in review["answer"].casefold(), review
    notified = api("/notifications", token=token)
    actual = next((item for item in notified["items"] if item["run_id"] == review["run_id"]), None)
    assert actual and actual["read_at"] is None
    checks.append("case_4_live_upload_triggers_real_grounded_notification")
    print("Use case 4: canlı dosya değerlendirmesi ve bildirim geçti.", flush=True)
    continued = ask(token, "Bu eksik için kimle konuşmalıyım ve ne zamana kadar tamamlamalıyız?", thread=actual["thread_id"])
    assert "koru" in continued["answer"].casefold() or "kvkk" in continued["answer"].casefold(), continued["answer"]
    checks.append("notification_followup_retains_context")
    api(f"/notifications/{actual['notification_id']}/read", token=token, method="PATCH")
    assert next(item for item in api("/notifications", token=token)["items"] if item["notification_id"] == actual["notification_id"])["read_at"]
    checks.append("notification_read_state_persists")
    results.append({"case": 4, "answer": review["answer"], "sources": review["sources"], "continued_answer": continued["answer"]})

    # A harmless, unrelated source must not create a made-up actionable alert.
    harmless = upload(token, "Ofis pano yazı tipi", "ofis-pano.md", "Ofis panosunda başlıklar 16 punto olarak yazılır. Bu yalnızca bir biçimlendirme notudur; görev, süre veya müşteri taahhüdü değişikliği içermez.")
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        candidates = api("/work/runs", token=token)["items"]
        quiet = next((run for run in candidates if run["kind"] == "artifact_review" and any(source["artifact_id"] == harmless["artifact_id"] for source in run["sources"])), None)
        if quiet and quiet["status"] in {"completed", "failed"}:
            assert quiet["status"] == "completed", quiet.get("error")
            break
        time.sleep(1)
    else:
        raise AssertionError("Quiet upload evaluation timed out")
    assert not any(item["run_id"] == quiet["run_id"] for item in api("/notifications", token=token)["items"]), quiet
    checks.append("harmless_upload_does_not_notify")
    print("Önemsiz dosya: bildirim üretmedi.", flush=True)
    report = STATE / "pusula-demo-smoke-report.json"
    report.write_text(json.dumps({"status": "passed", "base": BASE, "checks": checks, "results": results}, ensure_ascii=False, indent=2) + "\n")
    report.chmod(0o600)
    print(f"Pusula gerçek LLM demo kontrolü: {len(checks)} geçti. Rapor: {report}")


if __name__ == "__main__":
    main()
