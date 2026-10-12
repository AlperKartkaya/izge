# Public Pusula demo

## Scope

- Website stays at `izge.dev`; its existing demo links open `app.izge.dev`.
- Kerem Demir (Software Engineer) and Selin Aras (Team Lead) open the demo without
  email/password. Public visitors are Members, never administrators.
- Company mock records are shared, but visitor identities and private conversations
  are separate. Changing personas or cookies does not reset the IP quota.
- AI questions are limited to 10 accepted requests per IP per UTC clock hour.
  Provider planning/answer calls within a question are not separate quota units.
- Public visitors cannot change company records, manage users or launch automations,
  scenario evaluations, external tools or independent review jobs.
- Password login remains available for the deployment owner. Private deployments
  keep their existing sign-in page unless public demo is explicitly enabled.

## Railway app variables

```dotenv
IZGE_PUBLIC_DEMO_ENABLED=true
IZGE_PUBLIC_DEMO_HOURLY_LIMIT=10
IZGE_TRUST_RAILWAY_PROXY=true
```

Keep the existing DeepSeek configuration and `/data` volume. Do not enable proxy
trust on a direct/private ingress: Railway's public edge sanitizes `X-Real-IP`,
Nginx forwards it, and the loopback-only API explicitly validates it. Uvicorn must
run with `--no-proxy-headers` so arbitrary X-Forwarded-For cannot rewrite its peer.
Missing/malformed addresses must not provide a fresh quota identity.

Hourly counters live in SQLite, not browser state or process memory. Shared Wi-Fi
shares a quota; VPN/IP changes can obtain a different quota. This is cost control,
not proof of a person's identity. Hosting and DeepSeek still need spending alerts.

## Website 502

DNS resolving to Railway plus `railway-hikari` HTTP 502 means Railway's edge was
reached; it does not show that DNS should be replaced. Check the website service:

- Source is the intended repo and branch; Root Directory is `/`.
- `RAILWAY_DOCKERFILE_PATH=deploy/website.Dockerfile`.
- `PORT=80`, custom domain target port `80`, no start command override.
- Deployment is running; build and runtime logs have no startup error.

Leave the working Porkbun apex ALIAS and Railway verification TXT in place.

## Existing mock-data transfer

1. Identify the actual source mount; current local runtime uses Docker volume
   `izge-product-data` at `/data`, not a nonexistent `backend/data` directory.
2. Use SQLite online backup and include uploaded `storage` and `pasted` files.
   Preserve the original archive outside the destination volume.
3. Verify SQLite integrity, foreign keys, source-file presence and checksums.
4. Authenticate Railway CLI and link the exact project/environment/app service.
   Inspect the remote database before overwriting anything. Back it up first.
5. Transfer to a new staging directory, not directly over the running database.
   The locally installed Railway CLI may not support the newest volume-file/SFTP
   commands; inspect `railway ssh --help` and `railway volume --help` first.
6. Stop API/worker writers while keeping a maintenance/SSH process available.
   Do not remove the deployment and then expect to SSH into it.
7. Restore database plus files together, remove stale WAL/SHM files and revoke
   copied session tokens. Apply migrations before starting API/worker again.
8. Verify record counts, physical file access and real sign-in/AI behavior.
   Test redeploy persistence and a restore before treating backups as proven.

Never embed a data archive, admin credentials or API key in the image/Git repo.
Never silently replace a remote database containing new user work. Data-source
archives under ignored `backups/railway` are private operator artifacts.

## Acceptance

- Both custom domains return the intended surface over HTTPS.
- Persona buttons sign in without credentials; public Selin has no Admin access.
- Two visitors on the same IP cannot read each other's private conversations.
- The eleventh AI question returns 429 with Retry-After, including after persona
  switching or API restart; concurrent requests cannot exceed the quota.
- Forged client forwarding headers cannot change the trusted quota identity.
- Guest access cannot schedule background AI jobs or bypass the quota through
  alternative API routes.
- Source data remains unchanged; remote counts/files match the verified import.

## References

- [Railway 502 troubleshooting](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)
- [Railway public networking headers](https://docs.railway.com/networking/public-networking/specs-and-limits)
- [Railway employee confirmation of edge header sanitization](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86)
- [Railway CLI volume commands](https://docs.railway.com/cli/volume)
