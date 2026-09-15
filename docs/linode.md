# Linode PDF renderer

## Deployment

The renderer is staged on `poll-to-pdf` (Linode ID `105312987`), a 1 GB
Nanode in Newark (`us-east`), at `96.126.107.57`. It uses Ubuntu 24.04 LTS,
Node 22.23.2, the exact Puppeteer version in package.json, and Puppeteer's
matching Chrome build. SSH: `ssh po@96.126.107.57`.

The intended staging endpoint is `https://pdf-linode.app.do/api/render`.
**Production `pdf.app.do` and the Heroku apps have not been switched.**

### Recreate the server

1. Create a `g6-nanode-1` with image `linode/ubuntu24.04`, region `us-east`,
   1,024 MB swap, your SSH public key, and backups disabled. Generate the
   initial root password securely; never put it in Git or logs.
2. Copy `deploy/bootstrap.sh` to the new instance and run it as root. It
   installs system dependencies, Node, fonts, and a key-only `po` administrator.
   Subsequent access uses `po`; direct root/password SSH is disabled.
3. Extract this repository into `/opt/url-to-pdf-api`. Create
   `/etc/pdf-renderer.env` as root, mode 600, using `deploy/environment.example`.
   Transfer the existing Heroku `API_TOKENS` value securely. Do not source
   credentials from tracked files or print them in shell commands.
4. Run `sudo bash /opt/url-to-pdf-api/deploy/install.sh`. This installs locked
   production dependencies and explicitly checks browser installation, then
   installs the AppArmor profile, firewall, Caddy, and systemd service.
5. Add a DNS-only A record `pdf-linode.app.do` pointing to the server. Caddy
   obtains and renews its HTTPS certificate. Do not change `pdf.app.do`.
   Until the A record matches the instance, Caddy serves a 503 placeholder on
   HTTP. `pdf-https-ready.timer` checks once a minute, installs the HTTPS
   configuration when DNS is ready, and disables itself. This avoids repeated
   failed certificate requests while DNS still points at Heroku.
6. Reboot and verify SSH, `pdf-renderer`, `caddy`, and `nftables` recover.

For an update, extract a reviewed revision into the application directory and
rerun `deploy/install.sh`; it stops the renderer while dependencies change.
Keep the previous Git revision available for rollback. This instance serves
only staging traffic until a separately authorized production cutover.

## Runtime and API behavior

- Existing GET/POST `/api/render`, PDF options, content types, and API-key
  authentication are retained. The Rails app requires no committed change.
- `GET /healthz` requires the same `x-api-key` and returns `{"status":"ok"}`.
  This checks the HTTP process; a real render is the browser health check.
- One active render by default (`MAX_CONCURRENT_RENDERS`). Additional work
  returns HTTP 503 with `Retry-After: 2`; there is no hidden queue.
- `RENDER_TIMEOUT_MS=23000` leaves headroom for the Rails 25-second read timeout.
  A rendering deadline returns 504; Chrome is closed, with forced process-group
  cleanup after 750 ms if needed. systemd kills the whole service group on stop.
- The Node port listens on loopback. Caddy is the single trusted proxy.
  `ALLOW_HTTP=false`; Caddy supplies the HTTPS forwarding header.
- `ALLOW_URLS=domain:app.do,domain:app.ps` allows HTTPS on those domains and
  their subdomains using hostname comparisons. Existing `host:`, `regex:`, and
  literal-URL patterns remain supported. Regex patterns retain embedded colons.
- HTML input is disabled on this deployment. Firewall rules block the service
  user's private IPv4/IPv6 connections, including loopback, while permitting
  local DNS and replies to Caddy. Browser control uses a pipe, not a local port.
- Chrome uses its sandbox. Ubuntu's AppArmor profile permits user namespaces
  only for the installed Chrome path. Heroku's Procfile explicitly retains its
  former no-sandbox behavior; no Heroku deployment was performed.
- Limits: 800 MB service RAM, 512 MB service swap, 256 tasks, automatic restart.
  Backups and resizing are not enabled automatically.
- Raw browser errors, request headers, page console output, and render URLs are
  excluded from application logs to avoid exposing API keys and report tokens.
  Caddy access logging is not enabled.

## Validation commands

Run `npm ci`, `npm test` under Node 22 on a development machine. The full test
suite includes a 6.2 MB inline-HTML fixture; the harness exceeded Node's default
approximately 480 MB heap on the Nanode. Run the other tests there with:

```bash
NODE_ENV=production PUPPETEER_CACHE_DIR=/var/cache/pdf-renderer \
  node_modules/.bin/mocha --timeout 30000 --grep 'large html' --invert
```

Run server-side tests as `po`, not `pdf-renderer`: the production user's firewall
intentionally prevents the test HTTP client from connecting to its own local
server. Development dependencies are needed for tests; the deployment script
installs only production dependencies.

For real report checks, keep an API key in a private file and cases in a private
JSON file, outside Git. Each case has `name`, `url`, optional `options` (existing
GET query options), `expected_text`, and `absent_text`. Example with placeholders:

```json
[
  {
    "name": "english-results",
    "url": "https://poll.app.do/polls/EXAMPLE/results?access_token=PRIVATE_TOKEN",
    "options": {"pdf.format": "LETTER"},
    "expected_text": ["Expected report title"],
    "absent_text": ["Not Found (404)"]
  }
]
```

```bash
python3 scripts/smoke.py --endpoint https://pdf-linode.app.do/api/render \
  --key-file /private/key --cases /private/cases.json --output /private/results
```

The script requires Poppler (`pdfinfo`, `pdftotext`), checks PDF structure and
expected content, enforces the 25-second budget, and writes safe timing summaries.
Generated PDFs/text may contain private data: keep output outside Git and inspect
rendered pages with `pdftoppm` before declaring visual parity.

While DNS is pending:

```bash
ssh -N -L 19000:127.0.0.1:9000 po@96.126.107.57
# In another terminal, use the same smoke command with:
# --endpoint http://127.0.0.1:19000/api/render --tunnel
```

`--tunnel` sets the HTTPS proxy header only for this private test path. It does
not validate public TLS.

## Operations and eventual cutover

```bash
sudo systemctl status pdf-renderer caddy nftables
sudo systemctl show pdf-renderer -p MemoryCurrent -p MemoryPeak -p MemorySwapCurrent
sudo journalctl -u pdf-renderer --since '1 hour ago'
sudo journalctl -k --since '1 hour ago'
```

Keep Ubuntu security updates enabled; refresh pinned Node/Puppeteer/browser
versions deliberately and rerun report comparisons. Check `npm audit --omit=dev`:
legacy validation/logging dependencies still have advisories; this migration is
not a complete dependency modernization.

A future cutover requires a valid `pdf.app.do` certificate on this server before
traffic switches, the same API key, and successful temporary-host tests. Add the
production hostname to Caddy and obtain its certificate using DNS validation or
another approved pre-cutover method, then change its DNS record. Keep the old
Heroku service running through observation. Roll back by restoring the original
Heroku DNS target. Neither DNS cutover nor Heroku shutdown is part of this staging
migration.

## Migration validation (2026-09-15)

- Full local suite: 13 passing, including timeout recovery, concurrency,
  authentication, destination restrictions, PDF text, and large HTML; lint passes.
- Nanode focused suite: 12 passing. The excluded large inline-HTML test harness
  exhausted its default V8 heap; deployed URL rendering does not use that path.
- Compared real English and French results/statistics and an invoice against
  Heroku. Corresponding page counts matched; newer Chrome has minor typography
  differences. Charts, images, long-answer pagination, and invoice layout were
  visually inspected. A discarded French sample pointed to the wrong database
  and returned a 404; it was replaced with a valid French deployment sample.
- Ten locale/filter cases passed across en/fr/de/es/pt, with custom titles,
  accented characters, one selected question/statistic, Letter results, and A4
  statistics. Checks require question text and exclude an unselected question.
- Three consecutive 31-page production-URL exports: 10.09, 9.47, and 9.55 seconds.
  Final-build service peak memory: 505,069,568 bytes (about 482 MiB), with no
  service swap use. No Chrome processes remained after the checks.
- Live API: missing/invalid keys 401; unapproved/metadata destinations 403;
  simultaneous work 503; forced render deadline 504 in 23.08 seconds; following
  render 200 in 5.80 seconds. IPv4/IPv6 loopback access from the service user
  was blocked by the firewall.
- Local Rails integration returned a PDF attachment and correct filename using
  a process-only endpoint override through an SSH tunnel. No poll-app source,
  production configuration, or authentication middleware was changed.
- Automatic service recovery after SIGKILL passed (`NRestarts=1`); the server
  rebooted and all four units (renderer, Caddy, firewall, DNS timer) recovered.
  The first post-reboot 31-page export completed in 10.73 seconds; cold-start
  service peak memory was 711,102,464 bytes (about 678 MiB), without swap.
- Public HTTPS remains pending the DNS-only A record. Tunnel tests do not count
  as certificate or public-endpoint validation. The DNS timer activates HTTPS
  automatically once the temporary hostname points at the instance.
