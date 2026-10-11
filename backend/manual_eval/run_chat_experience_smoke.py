"""Exercise chat lifecycle, attachments and real models on a disposable deployment."""
import json
import os
from pathlib import Path
import time
from urllib import error, parse, request
from uuid import uuid4


def main():
    base = os.environ['IZGE_AGENT_QA_URL'].rstrip('/')
    target = parse.urlparse(base)
    assert target.hostname in {'localhost', '127.0.0.1'} and target.port not in {None, 8000, 8080, 8081}, 'Disposable deployment required'
    credentials = json.loads((Path.home() / '.local/share/izge/demo-credentials.json').read_text())
    token = None
    results = []

    def api(path, payload=None, method=None, content_type='application/json'):
        headers = {'Content-Type': content_type, 'Accept-Language': 'tr'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode() if payload is not None else None
        req = request.Request(base + '/api' + path, data=data, method=method, headers=headers)
        with request.urlopen(req, timeout=180) as response:
            return json.loads(response.read()) if response.status != 204 else None

    token = api('/auth/sign-in', credentials.get('users', credentials)['deniz'])['access_token']

    def ask(conversation, question, profile='ollama', **options):
        created = api('/work/ask', {'message': question, 'client_request_id': str(uuid4()), 'thread_id': conversation['thread_id'], 'thread_title': conversation['title'], 'thread_kind': 'direct', 'model_profile': profile, **options})
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            run = api('/work/runs/' + created['run_id'])
            if run['status'] in {'completed', 'failed'}:
                break
            time.sleep(1)
        results.append(run)
        assert run['status'] == 'completed', run.get('error') or run['status']
        print(profile, question[:40], 'PASS', [stage['key'] for stage in run['stages']], flush=True)
        return run

    try:
        conversation = api('/work/conversations', {'title': 'Sohbet QA'})
        run = ask(conversation, '.')
        assert run['answer'] == 'Size nasıl yardımcı olabilirim?' and run['sources'] == []
        assert 'retrieval' not in {stage['key'] for stage in run['stages']}
        run = ask(conversation, 'Merhaba, nasılsın?')
        assert run['sources'] == [] and 'retrieval' not in {stage['key'] for stage in run['stages']}
        boundary = 'qa-' + uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="teslim-kontrol.md"\r\nContent-Type: text/markdown\r\n\r\n# Teslim kontrolü\nTeknik kontrol noktası Cuma günü saat 15:00.\r\n--{boundary}--\r\n').encode()
        uploaded = api('/work/conversations/' + conversation['conversation_id'] + '/attachments', body, content_type='multipart/form-data; boundary=' + boundary)
        artifact_id = uploaded['message_metadata']['attachments'][0]['artifact_id']
        run = ask(conversation, 'Bu konuşmaya eklediğim teslim-kontrol.md dosyasına göre teknik kontrol noktası ne zaman?')
        assert artifact_id in {source['artifact_id'] for source in run['sources']}
        assert 'Cuma' in run['answer'] and '15' in run['answer']
        api('/work/conversations/' + conversation['conversation_id'], {'archived': True}, 'PATCH')
        assert conversation['conversation_id'] not in {item['conversation_id'] for item in api('/work/conversations')['items']}
        api('/work/conversations/' + conversation['conversation_id'], {'archived': False}, 'PATCH')
        api('/work/conversations/' + conversation['conversation_id'], method='DELETE')
        assert api('/work/runs?thread_id=' + conversation['thread_id'])['items'] == []
        try:
            ask(conversation, 'Tekrar aç')
        except error.HTTPError as exc:
            assert exc.code == 409
        else:
            raise AssertionError('Deleted conversation reopened')
        codex = api('/work/conversations', {'title': 'Yerleşik web araması QA'})
        run = ask(codex, "Web'de Python'ın resmi sitesinde arayıp güncel kararlı Python sürümünü kaynaklarıyla söyle.", 'codex', reasoning_effort='high', allow_external_tools=True)
        assert 'web_search' in {stage['key'] for stage in run['stages']}
        assert any(source.get('source_type') == 'web' and 'python.org' in source.get('url', '') for source in run['sources'])
        assert 'retrieval' not in {stage['key'] for stage in run['stages']}
        print('Conversation lifecycle, attachment retrieval, punctuation, small talk and Codex native web search PASS', flush=True)
    finally:
        output = Path(os.environ['IZGE_AGENT_QA_OUTPUT']).expanduser()
        output.write_text(json.dumps({'runs': results}, ensure_ascii=False, indent=2))
        output.chmod(0o600)


if __name__ == '__main__':
    main()
