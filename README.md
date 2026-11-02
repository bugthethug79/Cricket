# Cricket

Self-hosted, browser-only rooms with voice, camera, screen sharing and chat.
It is a single Go binary that contains the web app, the signaling server and a
**built-in STUN/TURN server** ([pion/turn](https://github.com/pion/turn)), so
you don't need to run coturn.

## Features

- **All-in-one rooms**: voice, camera, screen share (with tab or system audio where the browser supports it) and text chat.
- **People list** that everyone in the room can see, with live mic, camera, screen and speaking status.
- **No chat history for newcomers.** The server only relays chat to people who are connected right now and never stores it. Chat is also **end-to-end encrypted** (AES-GCM) with a key the server never receives.
- **Private, unguessable links.** A room can only be reached through its link, and nothing lists rooms. A link looks like:

  ```
  https://call.example.com/j#eyJ2IjoxLCJyb29tIjoi…   (~230 characters)
  ```

  The part after `#` is base64url-encoded JSON:

  ```json
  {"v":1,"room":"<256-bit room id>","key":"<512-bit secret key>"}
  ```

  Browsers never send the `#fragment` to the server, so the key stays out of access logs, proxies and `Referer` headers.
- **Not indexable.** Every response sends `X-Robots-Tag: noindex, nofollow, noarchive`, a `robots.txt` that disallows everything, and `Referrer-Policy: no-referrer`. The page itself also carries a `noindex` meta tag.

## How privacy works

1. **Creating a room.** The browser generates a random 64-byte key. HKDF turns it into an *auth token* and a *chat key*. The server receives only `SHA-256(auth token)` and returns a random 32-byte room id.
2. **Joining.** The browser derives the auth token from the link and sends it over the WebSocket. The server compares hashes in constant time. A wrong key and a missing room return the same error, so nobody can probe which room ids exist.
3. **Media.** Media is peer-to-peer WebRTC (DTLS-SRTP). The TURN server only forwards encrypted packets and can't decrypt them.
4. **TURN credentials** are short-lived HMAC credentials, handed out only to authenticated room members. The TURN server also refuses to relay into private or loopback networks.
5. **Nothing is persisted.** Rooms live in memory, a room is deleted after `ROOM_IDLE_TTL` with nobody in it, and restarting the server wipes every room. The app keeps no request logs.

Set `FORCE_RELAY=true` to send all media through your TURN server. Participants then never learn each other's IP addresses, at the cost of server bandwidth.

## Deploy with Docker (recommended)

You need a Linux server with a public IPv4 address and a DNS `A` record pointing at it.

```bash
cp .env.example .env      # set DOMAIN and PUBLIC_IP
docker compose up -d --build
```

Then open `https://DOMAIN`. Caddy gets a Let's Encrypt certificate automatically.

**Firewall: open these ports**

| Port | Proto | Purpose |
|---|---|---|
| 80, 443 | tcp | HTTPS (Caddy) |
| 3478 | udp + tcp | STUN / TURN |
| 49160–49200 | udp | TURN relay range (`TURN_MIN_PORT`–`TURN_MAX_PORT`) |

The compose file uses `network_mode: host`, which is the reliable way to run TURN in Docker. If you'd rather use port mapping, map every port 1:1, for example `-p 3478:3478/udp -p 3478:3478/tcp -p 49160-49200:49160-49200/udp -p 8080:8080`.

Docker image only (bring your own TLS proxy):

```bash
docker build -t cricket .
docker run -d --network host -e PUBLIC_IP=203.0.113.10 -e TRUST_PROXY=true cricket
```

## Run without Docker

```bash
go build -o cricket .
PUBLIC_IP=203.0.113.10 ./cricket
```

Or serve HTTPS directly with `TLS_CERT=/path/fullchain.pem TLS_KEY=/path/privkey.pem LISTEN_ADDR=:443`.

Browsers only allow camera, mic and screen capture on **HTTPS** (or `http://localhost` for local testing).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | HTTP listen address |
| `TLS_CERT` / `TLS_KEY` | – | Serve HTTPS directly |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting (enable behind a reverse proxy) |
| `CREATE_TOKEN` | – | If set, creating rooms requires this token. Joining never does |
| `MAX_PEERS_PER_ROOM` | `12` | Maximum participants per room |
| `MAX_ROOMS` | `1000` | Maximum rooms in memory |
| `ROOM_IDLE_TTL` | `6h` | How long an empty room keeps its link alive |
| `PUBLIC_IP` | auto | Public IPv4 (or hostname) used as the TURN relay address. **Set this** |
| `TURN_ENABLED` | `true` | Run the built-in TURN server |
| `TURN_HOST` | request host | Hostname put into the `turn:` URLs given to browsers |
| `TURN_PORT` | `3478` | STUN/TURN port (udp + tcp) |
| `TURN_MIN_PORT` / `TURN_MAX_PORT` | `49160` / `49200` | UDP relay port range |
| `TURN_SECRET` | random | HMAC secret for TURN credentials |
| `TURN_CRED_TTL` | `12h` | TURN credential lifetime |
| `TURN_REALM` | `cricket` | TURN realm |
| `TURN_ALLOW_PRIVATE_PEERS` | `false` | Allow relaying to private IPs (only for LAN-only deployments) |
| `FORCE_RELAY` | `false` | Route all media through TURN to hide participants' IPs |

## Limits

Media is a full mesh: each person sends their stream to everyone else. That
works well up to about 6–8 people with cameras on, or more with audio only.
Larger rooms would need an SFU, which is a bigger change.

## Development

```bash
go test ./...
go run .            # http://localhost:8080
```

```
main.go        startup, HTTP server
config.go      environment configuration
server.go      HTTP routes, security headers, room creation, ICE config
peer.go        WebSocket signaling per participant
hub.go         in-memory rooms, auth, presence, broadcast
turnserver.go  embedded STUN/TURN server
web/           client (vanilla JS, no build step, embedded into the binary)
```

## License

MIT, see [LICENSE](LICENSE).
