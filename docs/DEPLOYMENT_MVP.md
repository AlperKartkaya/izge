# Izge MVP deployment plan

Recommended MVP topology:

```txt
izge.dev           -> website/ static marketing site
app.izge.dev       -> frontend/dist/ React app
app.izge.dev/api   -> backend FastAPI service on localhost:8000 behind nginx
EC2 local/private LLM gateway -> Ollama or equivalent on 127.0.0.1:11434
```

This keeps the public story and protected product surface separate while letting the frontend call the API on the same origin (`/api`). Same-origin API routing avoids CORS and cookie/session surprises during the demo.

Deployment stance:

- `app.izge.dev` is the **jury/pilot environment**, not the long-term generic multi-tenant SaaS model.
- For the jury demo, storage and inference should run inside the Izge-controlled EC2 boundary.
- For customer production, the primary target remains self-hosted/customer-controlled deployment at an internal/customer URL with customer-controlled storage and local/private inference.
- Employee-local edge models are future optional capability and are not needed for the jury demo.

## DNS

Create these records at the domain registrar/DNS provider:

| Host | Type | Value |
| --- | --- | --- |
| `@` | `A` | EC2 public IPv4 address |
| `www` | `CNAME` | `izge.dev` |
| `app` | `A` | EC2 public IPv4 address |

Wait until these resolve before requesting TLS certificates:

```sh
dig +short izge.dev
dig +short app.izge.dev
```

## EC2 prerequisites

Assumptions:

- Ubuntu EC2 instance.
- SSH user is `ubuntu`.
- Repo is deployed under `/srv/izge/current`.
- Static assets are served from `/var/www/izge`.
- Backend runtime data is stored under `/srv/izge/data`.

Open EC2 security-group inbound ports:

- `22/tcp` from your IP only.
- `80/tcp` from anywhere.
- `443/tcp` from anywhere.

## First-time server setup

Run on the EC2 host:

```sh
sudo apt update
sudo apt install -y nginx python3.11-venv python3-pip nodejs npm rsync certbot python3-certbot-nginx

sudo useradd --system --create-home --home-dir /srv/izge --shell /usr/sbin/nologin izge || true
sudo mkdir -p /srv/izge/current /srv/izge/data /var/www/izge/website /var/www/izge/app /etc/izge
sudo chown -R izge:izge /srv/izge
```

## Copy the repo to EC2

From your local machine, replace `EC2_HOST` with the SSH host/IP:

```sh
rsync -az --delete \
  -e "ssh -i /path/to/your-key.pem" \
  --exclude '.git' \
  --exclude 'backend/.venv' \
  --exclude 'backend/data' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  ./ ubuntu@EC2_HOST:/tmp/izge-release/

ssh -i /path/to/your-key.pem ubuntu@EC2_HOST \
  'sudo rsync -a --delete /tmp/izge-release/ /srv/izge/current/ && sudo chown -R izge:izge /srv/izge/current'
```

## Backend service

Run on EC2:

```sh
sudo cp /srv/izge/current/deploy/env/backend.env.example /etc/izge/backend.env
sudo nano /etc/izge/backend.env  # set a real IZGE_DEFAULT_ADMIN_PASSWORD before first start
sudo chmod 640 /etc/izge/backend.env
sudo chown root:izge /etc/izge/backend.env

sudo -u izge python3 -m venv /srv/izge/venv
sudo -u izge /srv/izge/venv/bin/pip install --upgrade pip
sudo -u izge /srv/izge/venv/bin/pip install -e /srv/izge/current/backend

sudo cp /srv/izge/current/deploy/systemd/izge-backend.service /etc/systemd/system/izge-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now izge-backend
sudo systemctl status izge-backend --no-pager
curl -fsS http://127.0.0.1:8000/health
```

## EC2 local/private LLM gateway

For the jury demo, `app.izge.dev` should use an LLM reachable from the EC2 backend, preferably on loopback (`127.0.0.1`) or through a private inference endpoint. The current demo-friendly default is Qwen through an Ollama-compatible API.

Example Ollama setup on EC2:

```sh
# Install Ollama using the official installer or your preferred package path.
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model currently used by the Izge demo config.
ollama pull qwen3.5:4b

# Confirm the gateway is reachable from the EC2 host.
curl -fsS http://127.0.0.1:11434/api/tags
```

Then edit `/etc/izge/backend.env`:

```sh
IZGE_LOCAL_LLM_ENABLED=true
IZGE_LOCAL_LLM_BASE_URL=http://127.0.0.1:11434
IZGE_LOCAL_LLM_MODEL=qwen3.5:4b
IZGE_LOCAL_LLM_TIMEOUT_SECONDS=60

# Optional for richer demo behavior once the model is confirmed stable.
IZGE_LLM_QUERY_ROUTING_ENABLED=true
IZGE_LLM_ANSWER_SYNTHESIS_ENABLED=true
IZGE_LLM_SIGNAL_EXPLANATION_ENABLED=true
```

Restart the backend after changing LLM settings:

```sh
sudo systemctl restart izge-backend
sudo journalctl -u izge-backend -n 80 --no-pager
```

If the model is unavailable, Izge should still run using deterministic extraction/reasoning fallback. Do not use an external hosted AI endpoint for the primary jury demo path unless the product positioning is explicitly changed.

## Build and publish static assets

Run on EC2:

```sh
# Marketing website
sudo rsync -a --delete /srv/izge/current/website/ /var/www/izge/website/
```

```sh
# App frontend. The default API base is /api, which matches app.izge.dev/api.
cd /srv/izge/current/frontend
sudo -u izge npm ci
sudo -u izge npm run build
```

if it fails, run:

```sh
sudo bash -lc 'cd /srv/izge/current/frontend && npm install && npm run build'
```

```sh
sudo rsync -a --delete /srv/izge/current/frontend/dist/ /var/www/izge/app/

sudo chown -R www-data:www-data /var/www/izge
```

## Nginx

Run on EC2:

```sh
sudo cp /srv/izge/current/deploy/nginx/izge.conf /etc/nginx/sites-available/izge.conf
sudo ln -sf /etc/nginx/sites-available/izge.conf /etc/nginx/sites-enabled/izge.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

HTTP smoke checks:

```sh
curl -I http://izge.dev
curl -I http://app.izge.dev
curl -fsS http://app.izge.dev/health
```

## TLS

After DNS works and nginx serves HTTP:

```sh
sudo certbot --nginx -d izge.dev -d www.izge.dev -d app.izge.dev
sudo certbot renew --dry-run
```

Then verify:

```sh
curl -I https://izge.dev
curl -I https://app.izge.dev
curl -fsS https://app.izge.dev/health
```

LLM smoke check on EC2:

```sh
cd /srv/izge/current/backend
sudo -u izge env IZGE_LOCAL_LLM_MODEL=qwen3.5:4b /srv/izge/venv/bin/python - <<'PY'
from app.services.llm import run_structured_local_prompt
schema = {
    "type": "object",
    "properties": {"status": {"type": "string"}, "mode": {"type": "string"}},
    "required": ["status", "mode"],
    "additionalProperties": False,
}
result = run_structured_local_prompt(
    system_prompt="Return only valid JSON matching the schema.",
    user_prompt="Return status ok and mode smoke_test.",
    schema=schema,
)
assert result.get("status") == "ok", result
print(result)
PY
```

## Demo verification

Run locally on EC2 after deployment:

```sh
cd /srv/izge/current/backend
sudo -u izge /srv/izge/venv/bin/python -m manual_eval.run_isolated_seed_eval
```
if it fails, run:

```sh
sudo -u izge bash -lc 'cd /srv/izge/current/backend && /srv/izge/venv/bin/python -m manual_eval.run_isolated_seed_eval'
```


Then in the browser:

1. Open `https://izge.dev` and click **Open app**.
2. Sign in at `https://app.izge.dev` with the admin credentials from `/etc/izge/backend.env`.
3. Upload or use the demo seed artifacts.
4. Validate decision lineage, contradiction analysis, assumption drift, and next-action guidance before the live demo.

## Redeploy loop

For normal project changes, use the checked-in redeploy script from your local machine:

```sh
deploy/redeploy-ec2.sh --host EC2_PUBLIC_IP -i /path/to/your-key.pem
```

The script does not hardcode the EC2 address. Pass the host the same way you pass
the SSH key, or set it through `IZGE_EC2_HOST`.

Script defaults:

```txt
user: ubuntu
```

It uploads the repo, refreshes backend dependencies, restarts `izge-backend`,
publishes `website/`, builds and publishes `frontend/dist/`, reloads nginx,
and runs smoke checks. The backend health check waits for Uvicorn to bind
`127.0.0.1:8000`; if it still fails, the script prints recent
`izge-backend` systemd logs before exiting. The frontend build runs from inside
`sudo -u izge bash -lc 'cd /srv/izge/current/frontend && ...'` so restrictive
`/srv/izge` permissions do not block the deploy SSH user; if that build fails,
the script falls back to a root `npm install && npm run build` and repairs
ownership afterward.

Useful variants:

```sh
# If your key is already loaded into ssh-agent or ~/.ssh/config:
deploy/redeploy-ec2.sh --host EC2_PUBLIC_IP

# Run the isolated backend demo eval after publishing:
deploy/redeploy-ec2.sh --host EC2_PUBLIC_IP -i /path/to/your-key.pem --run-eval

# Override host/user:
deploy/redeploy-ec2.sh --host EC2_PUBLIC_IP --user ubuntu -i /path/to/your-key.pem

# Environment-variable form:
IZGE_EC2_HOST=EC2_PUBLIC_IP IZGE_SSH_KEY=/path/to/your-key.pem deploy/redeploy-ec2.sh
```

The manual loop below is kept as a fallback/debug reference.

After the first setup, a normal redeploy is:

```sh
# local machine
rsync -az --delete --exclude '.git' --exclude 'backend/.venv' --exclude 'backend/data' --exclude 'frontend/node_modules' --exclude 'frontend/dist' ./ ubuntu@EC2_HOST:/tmp/izge-release/
ssh ubuntu@EC2_HOST 'sudo rsync -a --delete /tmp/izge-release/ /srv/izge/current/ && sudo chown -R izge:izge /srv/izge/current'

# EC2
sudo -u izge /srv/izge/venv/bin/pip install -e /srv/izge/current/backend
sudo systemctl restart izge-backend
sudo rsync -a --delete /srv/izge/current/website/ /var/www/izge/website/
cd /srv/izge/current/frontend && sudo -u izge npm ci && sudo -u izge npm run build
sudo rsync -a --delete /srv/izge/current/frontend/dist/ /var/www/izge/app/
sudo chown -R www-data:www-data /var/www/izge
sudo nginx -t && sudo systemctl reload nginx
```
