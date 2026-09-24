# PDF renderer on the shared poll server

## Target and scope

Migration completed on 2026-09-17. `pdf-linode.app.do` now resolves to
`192.53.122.28` (DNS-only A record, TTL 300). The running application revision is
`44cb3618d206a3e24459c44869e835fed69e3d29`. Kamal manages the HTTPS certificate
and renewals using its persistent proxy certificate cache.

Kamal 2.12.0 deploys service `poll-to-pdf` to the shared `poll` Linode
(`100.67.232.123` over Tailscale, public IPv4 `192.53.122.28`).
The public endpoint remains `https://pdf-linode.app.do/api/render`.
After successful cutover checks, the old `poll-to-pdf` Nanode (ID `105312987`,
`96.126.107.57`) was deleted on 2026-09-17 at the owner's request. Do not restore
DNS to that retired address. The explicit `pdf.app.do` CNAME to Heroku was
removed on 2026-09-24. The `*.app.do` wildcard now resolves that name to the
shared `poll` server, where the poll app redirects it to `https://app.do/`.
`pdf.app.ps` was not changed.

## Image and isolation

The image uses Node 22.23.2, locked npm dependencies, Puppeteer's matching
Chrome, and the same font archive as the former systemd deployment. Application
files and browser binaries are owned by root; Node runs as the `node` user.
Docker's init process reaps orphaned browser processes.

Resource limits are 800 MiB RAM, 512 MiB additional swap, one CPU, and 256 tasks.
One render runs at a time, with a 23-second deadline; excess work returns 503.
Kamal's response timeout is 30 seconds; Rails retains its 25-second read timeout.
Plan for old and new containers to overlap during deployment.

`SYS_ADMIN` enables Chrome's sandbox in Docker, as required by Puppeteer's
[Docker guidance](https://pptr.dev/guides/docker). `NET_ADMIN` is used only at
startup to install IPv4 and IPv6 OUTPUT rules inside the container's own network
namespace. The entrypoint then removes `NET_ADMIN` from the capability bounding
set and drops to the Node user before executing application code. Rules allow
established replies and Docker DNS, and reject private, loopback, link-local,
Tailscale, multicast and reserved destinations. This protects the other services
on the shared Kamal network without changing the host firewall. Startup fails
if the firewall cannot be installed. No host ports or persistent volumes are
published by this service.

`GET /up` is a public, constant liveness response accepted over internal HTTP
for Kamal. `/healthz` and rendering routes still require HTTPS and the API key.
The health probe does not launch Chrome; always validate an actual PDF after
changing the image. Application logs omit raw render URLs and API keys.
The existing shared Kamal proxy logs request query strings (including report
access tokens), like it already does for the poll report routes. Its Docker
logs are root-only, local, and rotated at 100 MB across up to 50 files; never
forward these raw logs to another service or include them in support output.
API keys are headers and are not included in the proxy's configured request
headers.

## Deployment

1. Authenticate Tailscale SSH to `root@100.67.232.123`.
2. Keep the existing `.kamal/secrets` (mode 600). On a new deployment machine,
   copy `.kamal/secrets.example` and restore `API_TOKENS` from a secure copy or
   the running service's root-only Kamal environment file. Preserve the existing
   key so Rails clients continue to authenticate. The shared registry is
   `127.0.0.1:5555` on the host.
3. Commit the revision; Kamal builds committed source. Run `bin/deploy deploy`.
   The wrapper builds through the shared server's Docker daemon over SSH.
   Heavy image builds compete with Rails: monitor available RAM and CPU.
4. Check authenticated health and a real PDF after deployment.

### Completed host migration

For this migration, we transferred the existing Caddy certificate privately and
used a temporary Kamal configuration with `proxy.ssl.certificate_pem` and
`proxy.ssl.private_key_pem`. This allowed HTTPS and a real PDF to be checked on
the new IP with `curl --resolve` before DNS changed. After the DNS move we ran
`bin/deploy deploy --skip-push` with the committed automatic-HTTPS configuration;
Kamal issued a new certificate and replaced the bootstrap container. Temporary
certificate copies and the bootstrap secrets/configuration were then removed.
Never claim success based only on `/up`.

Useful commands:

```sh
bin/deploy app details
bin/deploy app logs
bin/deploy rollback COMMIT_SHA
```

Use Kamal rollback to a previously validated image on the shared server. Two
stopped containers are retained. The initial known-good image is
`44cb3618d206a3e24459c44869e835fed69e3d29`; the earlier preparation commits did
not contain a working Docker image. The retired Nanode is no longer a rollback
target. The renderer is stateless; source, locked dependencies, the API secret,
and Kamal's proxy certificate storage are sufficient to recreate it.

## Validation

```sh
npm test
sh -n deploy/container-entrypoint
bash -n bin/deploy
API_TOKENS=validation-only KAMAL_REGISTRY_PASSWORD=local-registry kamal config
```

Container checks must also confirm: sandboxed rendering succeeds; unapproved
hosts/HTML and missing keys are rejected; private IPv4/IPv6 connections fail;
`NET_ADMIN` is absent from the Node process's bounding set; timeout recovery and
concurrency limits work; memory stays below the limit; and poll apps remain
healthy. Use `scripts/smoke.py` with private key/case files for PDF comparisons.

## Migration validation (2026-09-17)

- Node 22 local suite: 14 tests pass, including unauthenticated liveness while
  authenticated routes still enforce HTTPS/API keys; lint passes. Shell syntax,
  Kamal configuration and `git diff --check` pass.
- Image build explicitly installs Chrome (including `unzip`) and checks the
  asynchronously resolved executable path. The runtime sets `HOME=/home/node`
  before dropping privileges, so Chrome can create its crash/profile data.
- Chrome reports namespace, PID, network and seccomp-BPF sandboxing active.
  Node runs with UID 1000, no effective capabilities and no `NET_ADMIN` in its
  bounding set. Connections to the host gateway, PostgreSQL, Redis, metadata,
  Tailscale and IPv6 loopback are rejected.
- Six actual results/statistics exports pass across fr/en/de/es/pt and A4/Letter.
  They match the original service's page counts (two-page results, three-page
  statistics), contain the expected titles, and show intact charts, accented
  text and multi-page answer lists on visual inspection.
- Direct-container renders take 6.28–7.55 seconds; public HTTPS renders take
  6.78–10.82 seconds. Candidate peak memory is 464,629,760 bytes (443 MiB),
  with no OOM events under the 800 MiB limit.
- Concurrent work returns 503 with `Retry-After: 2`; a forced deadline returns
  504 in 23.08 seconds; the next PDF succeeds in 6.46 seconds.
- Public checks: valid TLS, HTTP redirect, `/up` 200, `/healthz` 401 without a
  valid key and 200 with one; a metadata URL returns 403.
- Rails production integration uses the real report page, session and CSRF
  token: PDF attachment 200, correct filename, 66,197 bytes in 9.49 seconds.
  Run rendering checks sequentially: the renderer intentionally rejects
  concurrent checks with 503.
- Both poll-fr and staging `/up` remain healthy. After verification and explicit
  owner authorization, Linode ID `105312987` was deleted. The Linode inventory
  retains `poll` (ID `105330879`) and `serveur-prof`. At the time,
  `pdf.app.do` still pointed to Heroku; its explicit DNS record was removed on
  2026-09-24. A fresh PDF render was checked after the Nanode deletion.
- Automatic HTTPS was verified after the second Kamal rollout: the new
  certificate was issued on September 17 and expires December 16, 2026.
