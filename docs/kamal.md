# PDF renderer on the shared poll server

## Target and scope

Migration status: image validation in progress; DNS still routes to the original
Nanode until the cutover checks below succeed.

Kamal 2.12.0 deploys service `poll-to-pdf` to the shared `poll` Linode
(`100.67.232.123` over Tailscale, public IPv4 `192.53.122.28`).
The public endpoint remains `https://pdf-linode.app.do/api/render`.
The old Nanode (`96.126.107.57`) stays available for rollback until the new
service has been observed. This migration does not retire the Nanode or change
`pdf.app.do` or `pdf.app.ps`.

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
changing the image. Application logs omit raw render URLs and API keys. The existing shared
Kamal proxy logs request query strings (including report access tokens), like
it already does for the poll report routes. Its Docker logs are root-only,
local, and rotated at 10 MB; never forward these raw logs to another service
or include them in support output. API keys are headers and are not included
in the proxy's configured request headers.

## Deployment

1. Authenticate Tailscale SSH to `root@100.67.232.123`.
2. Copy `.kamal/secrets.example` to `.kamal/secrets`, set mode 600, and transfer
   the existing renderer's `API_TOKENS` privately. Do not generate a replacement
   key during migration. The existing registry is `127.0.0.1:5555` on the host.
3. Commit the revision; Kamal builds committed source. Run `bin/deploy deploy`.
   The wrapper builds through the shared server's Docker daemon over SSH.
   Heavy image builds compete with Rails: monitor available RAM and CPU.
4. For the first migration, validate the new container's authenticated health,
   actual English/French PDFs and network isolation before changing DNS.
   Record the original Cloudflare DNS record and retain the old renderer.
5. Move only the DNS-only A record `pdf-linode.app.do` from `96.126.107.57` to
   `192.53.122.28`. Kamal manages HTTPS automatically; certificate issuance
   requires that DNS route to the new host. Verify public TLS and PDF rendering
   after the move, including Rails' download attachment flow.

The old endpoint remains live while preparing the new container. For an initial
pre-DNS validation, use an isolated candidate container or a temporary hostname;
`kamal deploy` with automatic HTTPS may wait for DNS/certificate validation.
Never claim success based only on `/up`.

Useful commands:

```sh
bin/deploy app details
bin/deploy app logs
bin/deploy rollback COMMIT_SHA
```

Rollback the initial host move by restoring the saved Cloudflare A record to
`96.126.107.57`. Leave Caddy and `pdf-renderer` running on that host throughout
the observation period. For subsequent code changes, use Kamal rollback.

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
