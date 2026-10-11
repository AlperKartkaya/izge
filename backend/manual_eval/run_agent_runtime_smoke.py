"""Real-model smoke checks; requires an explicit disposable loopback deployment."""
import json
import os
from pathlib import Path
import re
import time
from urllib import parse, request
from uuid import uuid4

BASE = os.environ.get('IZGE_AGENT_QA_URL','').rstrip('/')

def main():
    url = parse.urlparse(BASE)
    assert url.hostname in {'127.0.0.1','localhost'} and url.port not in {None,8080,8081,8000}, 'Disposable loopback deployment required.'
    credentials=json.loads((Path.home()/'.local/share/izge/demo-credentials.json').read_text())
    user=credentials.get('users',credentials)['deniz']
    token=None
    def api(path,payload=None):
        headers={'Content-Type':'application/json','Accept-Language':'tr'}
        if token: headers['Authorization']='Bearer '+token
        req=request.Request(BASE+'/api'+path, data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
        with request.urlopen(req,timeout=60) as response: return json.load(response)
    token=api('/auth/sign-in',{'email':user['email'],'password':user['password']})['access_token']
    catalog=api('/work/models')
    profiles={p['id']:p for p in catalog['profiles']}
    results=[]
    def ask(question,profile,**options):
        run=api('/work/ask',{'message':question,'client_request_id':str(uuid4()),'thread_id':'qa:agent:'+str(uuid4()),'thread_title':'Agent çalışma kontrolü','thread_kind':'direct','model_profile':profile,**options})
        deadline=time.monotonic()+420
        while time.monotonic()<deadline:
            run=api('/work/runs/'+run['run_id'])
            if run['status'] in {'completed','failed'}: break
            time.sleep(1)
        results.append(run)
        assert run['status']=='completed',run.get('error') or run['status']
        assert run['answer'].strip()
        assert all(s['status']=='completed' for s in run['stages']),run['stages']
        assert len({s['key'] for s in run['stages']})==len(run['stages'])
        print(profile,question[:40], 'PASS', [s['key'] for s in run['stages']],flush=True)
        return run
    try:
        for profile in os.environ.get('IZGE_AGENT_QA_PROFILES','ollama,codex,glm,deepseek').split(','):
            if not profiles[profile]['enabled']:
                print(profile,'SKIP: not configured',flush=True)
                continue
            options={'reasoning_effort':'low'} if profile=='codex' else {}
            capability=ask('Ne yapabilirsin benim için?',profile,**options)
            assert capability['sources']==[] and not re.search(r'\[\d+\]',capability['answer'])
            assert 'Fatura kesemem' in capability['answer']
            assert 'Yetenekler ve izinler hazır' in {s['label'] for s in capability['stages']}
            assert 'retrieval' not in {s['key'] for s in capability['stages']}
            company=ask('Atlas müşterisi için faturalanmamış ek işleri sözleşme, çalışma kayıtları ve faturalarla karşılaştır. Kesinleşmiş tutar ile onay bekleyen tutarı ayır.',profile,request_reviewer=True,**options)
            assert company['sources'] and 'reviewer' in {s['key'] for s in company['stages']}
            assert all(s.get('source_type','artifact')=='artifact' for s in company['sources'])
    finally:
        destination=Path(os.environ['IZGE_AGENT_QA_OUTPUT']).expanduser()
        destination.write_text(json.dumps({'catalog':catalog,'runs':results},ensure_ascii=False,indent=2))
        destination.chmod(0o600)

if __name__=='__main__':main()
