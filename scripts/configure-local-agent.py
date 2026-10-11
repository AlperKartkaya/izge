#!/usr/bin/env python3
"""Apply private provider settings and versioned compose to the existing Coolify service."""
import base64
import json
from pathlib import Path
import urllib.request

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path.home() / '.local/share/izge/coolify'
KEYS = ['MODEL_PROVIDER','MODEL_EFFORT','GLM_API_KEY','DEEPSEEK_API_KEY','CODEX_BRIDGE_BASE_URL','CODEX_BRIDGE_TOKEN','ONPREM_BASE_URL','ONPREM_MODEL','ONPREM_API_KEY','ALLOW_PUBLIC_ONPREM_URL','WEB_SEARCH_KEY','MCP_CONNECTORS_JSON']

def settings():
    values = {**dotenv_values(ROOT/'backend/.env'), **dotenv_values(ROOT/'.env')}
    for name, aliases in {'GLM_API_KEY':['GLM_API_KEY','ZAI_API_KEY'], 'DEEPSEEK_API_KEY':['DEEPSEEK_API_KEY'], 'WEB_SEARCH_KEY':['BRAVE_API_KEY']}.items():
        key = 'IZGE_AGENT_'+name
        if not values.get(key):
            values[key] = next((values[alias] for alias in aliases if values.get(alias)), '')
    defaults = {'MODEL_PROVIDER':'ollama','MODEL_EFFORT':'none','ALLOW_PUBLIC_ONPREM_URL':'false','MCP_CONNECTORS_JSON':'[]'}
    bridge = Path.home()/'.local/share/izge/model-bridge/bridge.env'
    if bridge.exists():
        defaults.update(CODEX_BRIDGE_BASE_URL='http://host.docker.internal:8766', CODEX_BRIDGE_TOKEN=dotenv_values(bridge)['CODEX_BRIDGE_TOKEN'])
    selected = {'IZGE_AGENT_'+name: values.get('IZGE_AGENT_'+name) or defaults.get(name,'') for name in KEYS}
    connectors = json.loads(selected['IZGE_AGENT_MCP_CONNECTORS_JSON'])
    assert isinstance(connectors, list), 'MCP configuration must be an array.'
    for connector in connectors:
        name = connector.get('token_env') if isinstance(connector,dict) else None
        if name:
            assert isinstance(name,str) and name.replace('_','').isalnum() and not name[0].isdigit(), 'Invalid MCP token environment name.'
            if values.get(name):
                selected[name] = values[name]
    return selected

def main():
    resource = json.loads((RUNTIME/'resource.json').read_text())
    token = (RUNTIME/'ssh/local_api_token').read_text().strip()
    url = f"http://127.0.0.1:8000/api/v1/services/{resource['service_uuid']}"
    def api(suffix, payload):
        req=urllib.request.Request(url+suffix, data=json.dumps(payload).encode(),method='PATCH',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=30) as response:
            assert response.status in {200, 201}
    values=settings()
    assert values['IZGE_AGENT_MODEL_PROVIDER'] in {'ollama','codex','glm','deepseek','onprem'}
    data=[{'key':key,'value':value,'is_literal':True} for key,value in values.items()]
    api('/envs/bulk',{'data':data})
    compose_text=(ROOT/'deploy/izge-local.compose.yml').read_text()
    extra=''.join('      '+key+': "${'+key+'}"\n' for key in values if key not in {'IZGE_AGENT_'+name for name in KEYS})
    compose_text=compose_text.replace('      IZGE_AGENT_MCP_CONNECTORS_JSON:',extra+'      IZGE_AGENT_MCP_CONNECTORS_JSON:')
    compose=base64.b64encode(compose_text.encode()).decode()
    api('',{'docker_compose_raw':compose,'instant_deploy':False})
    print('Provider settings applied without exposing keys; deployment still needs restart.')
    print('Configured: '+', '.join(name for name,key in [('Codex','CODEX_BRIDGE_TOKEN'),('GLM','GLM_API_KEY'),('DeepSeek','DEEPSEEK_API_KEY'),('Web','WEB_SEARCH_KEY')] if values['IZGE_AGENT_'+key]))

if __name__ == '__main__':
    main()
