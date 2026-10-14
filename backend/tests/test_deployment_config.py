import configparser
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class DeploymentConfigTests(unittest.TestCase):
    def test_shell_entrypoint_and_migration_order(self):
        entrypoint = ROOT / "deploy/app/entrypoint.sh"
        subprocess.run(["sh", "-n", str(entrypoint)], check=True)
        text = entrypoint.read_text()
        self.assertIn('umask 077', text)
        self.assertIn('\npython -m app.migration_tools upgrade\n', text)
        self.assertLess(text.index('migration_tools upgrade'), text.index('exec /usr/bin/supervisord'))
        for port in ("", "abc", "0", "65536", "80;echo bad"):
            result = subprocess.run(["sh", str(entrypoint)], env={"PORT": port}, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"PORT", result.stderr)

    def test_processes_share_disk_and_use_actual_worker(self):
        config = configparser.ConfigParser(interpolation=None)
        config.read(ROOT / "deploy/app/supervisord.conf")
        self.assertIn('app.colleague_worker', config['program:colleague']['command'])
        self.assertIn('--host 127.0.0.1', config['program:api']['command'])
        for name in ('api', 'colleague', 'nginx'):
            self.assertEqual(config[f'program:{name}']['stopasgroup'], 'true')
            self.assertEqual(config[f'program:{name}']['autorestart'], 'true')
        docker = (ROOT / "Dockerfile").read_text()
        self.assertIn('IZGE_SQLITE_PATH=/data/izge.db', docker)

    def test_public_proxy_and_build_context_boundaries(self):
        nginx = (ROOT / 'deploy/app/nginx.conf.template').read_text()
        self.assertIn('proxy_buffering off;', nginx)
        self.assertIn('location /api/ {\n    proxy_read_timeout 180s;', nginx)
        self.assertIn('proxy_set_header X-Forwarded-Proto https;', nginx)
        self.assertNotIn('$proxy_add_x_forwarded_for', nginx)
        self.assertIn('proxy_set_header X-Forwarded-For $remote_addr;', nginx)
        ignore = (ROOT / '.dockerignore').read_text().splitlines()
        self.assertIn('**/.env', ignore)
        self.assertIn('backups', ignore)
        self.assertNotIn('website', ignore)
        self.assertFalse((ROOT / 'deploy/coolify-local.compose.yml').exists())
        self.assertNotIn('coolify', (ROOT / 'scripts/local-demo.sh').read_text().lower())
        self.assertIn('https://app.izge.dev', (ROOT / 'website/index.html').read_text())


if __name__ == '__main__':
    unittest.main()
