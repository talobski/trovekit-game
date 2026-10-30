# Secure self-hosting

This deployment model serves the multiplayer game publicly over HTTPS/WSS and
keeps content administration on localhost, reached directly or through SSH.
There are no user accounts and no automatically installed content packs. The
application and examples use the Trovekit Game product name.

## Supported runtime and process layout

Use Node 22.22.2, the runtime verified for this release. The package engine is
pinned to that tested version; verify newer releases before expanding the range.
The commands below assume a POSIX shell.

Supported environments: Node 22.22.2 on macOS or Linux, running one long-lived
process with a persistent local disk. CI runs the full test suites on Ubuntu
Linux, and development happens on macOS. The systemd and nginx examples below are
starting points that have not been verified as production services. Windows,
containers, serverless platforms and multi-instance hosting are not supported
or verified.

```sh
npm ci
npm run build
HOST=127.0.0.1 PORT=4747 \
  TROVEKIT_DATA=/var/lib/trovekit \
  PUBLIC_ORIGIN=https://game.example \
  TRUSTED_PROXIES=127.0.0.1 \
  npm start
```

Replace `game.example`, the installation directory and data directory with your
own values. Build with development dependencies installed. Production still needs
`tsx`, `sharp`, the server/source files, and the built `dist` directory; `dist`
alone is not a deployment. The theme is self-contained and does not require a sibling repository.

Run **one game process and at most one admin process per data directory**. JSON
files and in-memory rooms do not coordinate multiple game workers. Do not enable
cluster mode, replicas or serverless/ephemeral storage. Keep build/source files
read-only to the runtime account and uploaded data outside `dist` and `public`.
The configured static root may be a deployment symlink; symlinks beneath that
root are not served. Updating the build tree is a trusted operator operation.

Use a dedicated, unprivileged service account, with the data directory readable
and writable only by that account. New configured data directories use mode 0700;
new JSON files use 0600. Existing permissions are not changed automatically.
The admin must use the same data directory and an OS account with access to it.

Example systemd service (adjust the Node executable path to your installation):

```ini
[Unit]
Description=Trovekit Game multiplayer server
After=network.target

[Service]
Type=simple
User=trovekit
WorkingDirectory=/srv/trovekit-game
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4747
Environment=TROVEKIT_DATA=/var/lib/trovekit
Environment=PUBLIC_ORIGIN=https://game.example
Environment=TRUSTED_PROXIES=127.0.0.1
ExecStart=/usr/bin/node --import tsx server/main.ts
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

The account and data directory must already exist. This is an example service
configuration, not an automatically installed or verified production service.

## HTTPS/WSS reverse proxy

The Node server speaks HTTP and WebSocket. Terminate TLS at a maintained reverse
proxy and allow inbound public traffic only on HTTPS (and optionally HTTP for
redirects/certificate issuance). Keep backend ports 4747 and 4748 unreachable
from the public network. Development Vite/HMR servers must not be publicly exposed.

`PUBLIC_ORIGIN` is the exact browser origin, including a non-default port if used,
with no trailing slash. Browser API requests and WebSocket handshakes carrying an
Origin header must match it. Without this setting, direct local HTTP uses the
request's `http://Host` origin. Non-browser clients may omit Origin, but still
need a valid bearer session for private room state and actions.

Example nginx configuration, with the `map` and limit zones inside its `http`
context. Configure real certificates and replace the domain and certificate paths.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
limit_req_zone $binary_remote_addr zone=game_requests:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=game_connections:10m;

server {
    listen 80;
    server_name game.example;
    return 301 https://game.example$request_uri;
}

server {
    listen 443 ssl;
    server_name game.example;
    ssl_certificate /etc/letsencrypt/live/game.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 16k;
    client_header_timeout 10s;
    client_body_timeout 15s;
    limit_req_status 429;
    limit_conn_status 429;

    # Defense in depth: the backend also rejects these routes.
    location ^~ /admin { return 404; }

    location / {
        limit_req zone=game_requests burst=60 nodelay;
        limit_conn game_connections 32;
        proxy_pass http://127.0.0.1:4747;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        # Overwrite; do NOT use $proxy_add_x_forwarded_for here.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 75s;
        proxy_buffering off;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy same-origin always;
        add_header X-Frame-Options DENY always;
    }
}
```

WebSocket upgrades require explicit Upgrade/Connection forwarding. The proxy read
timeout must exceed two application heartbeat intervals (default 30 seconds).
Validate your actual nginx configuration before use. See the official
[WebSocket proxy guide](https://nginx.org/en/docs/http/websocket.html) and
[request-limit documentation](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).

### Proxy trust

By default forwarded headers are ignored and rate limits use the TCP peer IP.
`TRUSTED_PROXIES` accepts exact immediate-peer IP addresses, comma-separated;
CIDRs, hostnames and wildcard trust are not supported. An explicitly trusted peer
must supply **one valid IP** in `X-Forwarded-For`; missing or comma-separated values
are rejected. `Forwarded`, `X-Real-IP` and `X-Forwarded-Proto` are not used.

The example trusts only the local nginx process and overwrites client-supplied
forwarding headers. If you use another proxy topology, ensure the last trusted
proxy derives and overwrites the client IP safely. Do not trust arbitrary remote
clients or expose a backend that accepts spoofed forwarding headers. Raw TCP limits
still apply globally; the per-peer TCP cap is waived for configured proxies so
one proxy can carry many players. Per-client HTTP and WebSocket limits still apply.

## Private admin through SSH

On the server, start the admin under an account with access to the same library:

```sh
cd /srv/trovekit-game
TROVEKIT_DATA=/var/lib/trovekit ADMIN_PORT=4748 npm run admin:start
```

On your own computer, open a loopback-only tunnel:

```sh
ssh -N -L 127.0.0.1:4748:127.0.0.1:4748 user@server
```

Visit `http://127.0.0.1:4748`. The local forwarded port must match `ADMIN_PORT`
because admin Host validation includes the port. If that port is occupied, select
another ADMIN_PORT and use it on both sides of the tunnel.

The admin always binds to 127.0.0.1, regardless of HOST. Its Host check and fixed
`X-Trovekit-Admin: 1` header defend browser access boundaries; they are not account
authentication. Local processes and users able to access the tunnel are trusted.
In development, the admin's separate Vite WebSocket listener also binds to
127.0.0.1 at ADMIN_PORT + 10. The SSH instructions above use production mode,
which needs no additional development port.
Do not publish this port, add it to the public reverse proxy, or treat the header
as a secret. Import/export and image uploads remain available through the tunnel.
Private admin upload connections allow 120 seconds; graceful shutdown still drains
for at most five seconds, so finish uploads before stopping it.

## Configuration and limits

Set environment variables in the shell or service manager. `.env` files are not
loaded automatically. Invalid settings fail startup with an explicit error.
Ports must be integers 1–65535 (at most 65525 in development, to leave room for
HMR). HOST accepts an IP address or `localhost`. Data paths may be absolute or
relative to the process working directory; use an absolute path in production.
An empty path, filesystem root, project root, public/build directory, or a file
is rejected. `~` must be expanded by the shell. BOT_DELAY_MS accepts 0–60000.

| Variable | Default | Meaning |
| --- | --- | --- |
| PORT / HOST | 4747 / 0.0.0.0 | Game bind address; use 127.0.0.1 behind a local proxy |
| ADMIN_PORT | 4748 | Admin port, always loopback |
| TROVEKIT_DATA | project `data/` | Persistent rooms, content and artwork |
| PUBLIC_ORIGIN | unset | Exact browser origin; set for HTTPS deployment |
| TRUSTED_PROXIES | unset | Exact trusted immediate proxy IPs |
| BOT_DELAY_MS | 1200 | Delay before a bot move |
| MAX_ROOMS | 100 | Concurrent retained rooms, including finished rooms |
| ROOM_CREATES_PER_MINUTE | 6 | Creation attempts per client IP |
| REQUESTS_PER_MINUTE | 600 | HTTP requests per client IP; also the separate upgrade-attempt rate |
| MAX_CONNECTIONS | 512 | Global game TCP connections |
| CONNECTIONS_PER_IP | 64 | TCP connections per untrusted immediate peer |
| MAX_WEBSOCKETS | 256 | Global WebSocket connections, including unauthenticated ones |
| WEBSOCKETS_PER_IP | 16 | WebSockets per client IP |
| WEBSOCKETS_PER_SESSION | 4 | WebSockets per room/player session |
| WS_MESSAGES_PER_MINUTE | 30 | Incoming messages/ping/pong events per socket |
| WS_MAX_MESSAGE_BYTES | 4096 | Maximum incoming WebSocket message bytes |
| WS_MAX_BUFFERED_BYTES | 1048576 | Maximum queued outgoing bytes, including the next snapshot |
| WS_AUTH_TIMEOUT_MS | 5000 | Deadline for the first text hello |
| WS_HEARTBEAT_MS | 30000 | Ping interval; missed responses terminate stale sockets |
| ROOM_IDLE_MS | 604800000 | Maximum room inactivity; capped further by each phase's existing expiry |
| REQUEST_TIMEOUT_MS | 15000 | Game HTTP request receive deadline |
| HEADERS_TIMEOUT_MS | 10000 | Header receive deadline; must not exceed request timeout |
| CONNECTION_IDLE_MS | 30000 | Game HTTP socket inactivity timeout |
| MAX_RATE_CLIENTS | 4096 | Maximum remembered IP buckets in each limiter |

Resource limits are positive integers, up to 2147483647; they cannot be disabled
with zero. Use sensible values near the defaults. If you shorten heartbeat times,
allow enough incoming pong events in WS_MESSAGES_PER_MINUTE. Lowering MAX_ROOMS
below recovered live room count fails startup without silently dropping rooms.

Rate limits use one-minute windows, include unsuccessful attempts, and reset on
process restart. HTTP 429 responses include Retry-After. New clients are refused
if a limiter's bounded table is full; expired entries are removed. Shared NATs
share IP quotas. These limits constrain a small instance; they are not protection
against a distributed denial-of-service attack. Keep proxy/network limits too.

The HTTP game body limit remains 16 KB. WebSocket compression is disabled, messages
have fragmentation limits, and the protocol accepts one text hello per connection.
Oversized/invalid messages and slow consumers are disconnected. Healthy clients
receive pings automatically and reconnect using their existing bearer token.

Sessions are scoped to room membership and lifetime, not separate user accounts.
Leaving a lobby immediately revokes its token and live subscriptions. Rooms expire
after 24 idle hours in a lobby, seven idle days during play, or 24 idle hours after
finish/abandonment, additionally bounded by ROOM_IDLE_MS. Only saved room changes
refresh inactivity; polling, pongs and open sockets do not keep a room alive.
Expired rooms lose timers, presence and subscriptions. There is no automatic turn
forfeit, player removal during play, or token rotation on reconnect.

## Health, shutdown and recovery

- `GET /healthz`: process liveness.
- `GET /readyz`: recovery/storage status, readable content index/active content,
  accessible room directory and production entry-page existence. Empty content
  is ready. Responses contain only `{ "ok": true/false }`, with 200 or 503.
- These endpoints share request limits and proxy-IP validation. They do not write
  test data or prove future disk capacity/durability.

SIGINT/SIGTERM stop new work, stop bot timers, close WebSockets with a shutdown
code, and drain HTTP responses for up to five seconds before force-closing remaining
connections. Configure the process manager's stop timeout above five seconds.

Room mutations are prepared separately and published to memory/clients only after
an atomic JSON replacement succeeds. Failed saves return 503 and retain the previous
revision, allowing a retry. Bot write failures are logged and retried no faster
than every five seconds. New rooms are not retained if their initial write fails.
Each saved room is limited to 8 MB. This is a storage safeguard for extremely long
sessions, not a turn limit or a change to game rules.

On startup, invalid Schema v2 room files are reported and left intact, while valid
rooms recover. Readiness remains false if invalid current-format rooms were skipped.
Older unsupported formats remain untouched and are not loaded. A corrupt content
index stops startup with a clear error; it is never replaced with an empty library.
Do not have a supervisor automatically erase data to resolve readiness failures.

Back up `content`, `assets` and `rooms` together. Stop both processes for a consistent
file-copy backup, restore into a separate directory first, validate ownership and
permissions, then verify readiness and a saved-room reconnect before switching the
service's data path. After a disk-write failure, readiness clears following a
successful room write or a healthy restart. Repair/move corrupt current-format room
files explicitly, keeping a backup, and restart to clear recovery failure status.
Atomic rename prevents partially replaced files; this is not a transactional database
or a guarantee against sudden power loss. Monitor disk space and logs.

## Local and LAN development

Use `npm run dev` and `npm run admin` on the development machine. For phones on a
trusted LAN, the game may use `http://<LAN-IP>:4747`; action IDs use the Web Crypto
`getRandomValues` API, which is available without HTTPS. The admin stays on the host
machine's loopback address. A phone viewport browser test is not a physical-device test.

Use HTTPS/WSS on untrusted networks: session bearer tokens otherwise travel in
plaintext. Clipboard APIs may be unavailable on LAN HTTP; the invite UI retains a
manual-copy fallback. Do not expose Vite/HMR, the admin or its tunnel publicly.

## Remaining boundaries

Guest room codes allow lobby joining and public previews include player names.
There is no lobby password, human kick/ban control, account recovery or anti-cheat
service. Session tokens remain in browser localStorage and grant that player's
room access. Keep this application on a dedicated origin and keep dependencies
updated. The application sends no Content-Security-Policy header, and the nginx
example adds none. The UI's toast and drawer components insert `<style>` elements
at runtime, so a strict `style-src` would break them; test any policy you add.

Uploaded artwork is retrievable by anyone who knows its content-addressed URL,
including staged/draft images. Archive/replacement does not revoke cached image URLs.
Assets are retained rather than automatically garbage-collected. Keep private
material out of uploads and monitor disk usage. Only trusted local administrators
can import packs and artwork; the public game server has no upload endpoints.

## Upgrading

Stop both processes on upgrade, restart them together and reload open tabs; do not
mix server versions against the same data directory. Test restored copies before
switching production data paths. `TROVEKIT_DATA` is the only library setting.
Browser sessions and preferences are stored per origin under `trovekit:*` keys, so
changing the hostname, port or protocol means players lose their saved seats.
