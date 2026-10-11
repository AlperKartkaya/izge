#!/usr/bin/env python3
"""Install/update the host-only Codex bridge without sharing its OAuth credentials."""
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path.home() / '.local/share/izge/model-bridge'
LABEL = 'local.izge.codex-model-bridge'

def main():
    assert shutil.which('launchctl'), 'This local bridge installer requires macOS.'
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    RUNTIME.chmod(0o700)
    env = RUNTIME / 'bridge.env'
    token = env.read_text().strip().split('=', 1)[1] if env.exists() else secrets.token_hex(32)
    assert len(token) >= 32 and '\n' not in token
    env.write_text(f'CODEX_BRIDGE_TOKEN={token}\n')
    env.chmod(0o600)
    # launchd cannot read Documents on some Macs; keep a private runtime copy.
    source = RUNTIME / 'codex-model-bridge.py'
    shutil.copyfile(ROOT / 'scripts/codex-model-bridge.py', source)
    source.chmod(0o600)
    log = RUNTIME / 'bridge.log'
    log.touch(mode=0o600, exist_ok=True)
    log.chmod(0o600)
    agents = Path.home() / 'Library/LaunchAgents'
    agents.mkdir(parents=True, exist_ok=True)
    plist = agents / f'{LABEL}.plist'
    config = {'Label':LABEL, 'ProgramArguments':['/usr/bin/python3',str(source)], 'WorkingDirectory':str(RUNTIME), 'RunAtLoad':True, 'KeepAlive':True, 'EnvironmentVariables':{'CODEX_BRIDGE_TOKEN':token,'CODEX_BRIDGE_HOST':'127.0.0.1','CODEX_BRIDGE_PORT':'8766'}, 'StandardOutPath':str(log), 'StandardErrorPath':str(log)}
    plist.write_bytes(plistlib.dumps(config))
    plist.chmod(0o600)
    domain = f'gui/{os.getuid()}'
    loaded = subprocess.run(['launchctl','print',f'{domain}/{LABEL}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if loaded:
        subprocess.run(['launchctl','bootout',f'{domain}/{LABEL}'],check=True)
    subprocess.run(['launchctl','bootstrap',domain,str(plist)], check=True)
    print('Codex bridge installed on 127.0.0.1:8766 (private token, read-only Codex login).')

if __name__ == '__main__':
    main()
