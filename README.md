# CRICKET.

Cricket is a **AIO** calling app meant to replace *Jitsi meet* and *screengo* with a beautiful ui and a single binary!

Features include
- Link keyd (the key to join the call is within the link.)
- E2EE chat.
- Calling
- Screen sharing
- Camera sharing
- Decenteralized.
- Beatiful ui.

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

## License

MIT, see [LICENSE](LICENSE).
