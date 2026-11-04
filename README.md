# Cricket

Cricket is a video conferencing, selfhostable, e2ee and decenteralized platform with privacy at the forefront!

> [!WARNING]
> This is very alpha software! Host at your own disgression!

To build Cricket youll need ``make`` and a ``go-toolchain`` once youve gotten all of the requirements we can build!

```shell
make build
```

## CONFIGURATION
And their defaults are...

## CONFIGURATION

The environment variables and their default values are

```shell
LISTEN_ADDR=:8080
TLS_CERT=
TLS_KEY=
TRUST_PROXY=false
CREATE_TOKEN=

MAX_PEERS_PER_ROOM=12
MAX_ROOMS=1000
MAX_ROOMS_PER_IP=20
ROOM_EMPTY_TTL=5m
BAN_BY_IP=true
CREATE_RATE_PER_MIN=10
CREATE_BURST=5
JOIN_RATE_PER_MIN=30
JOIN_BURST=15
IPV6_PREFIX_LEN=64
MAX_CONNS=2000
MAX_CONNS_PER_IP=20
SIGNAL_RATE_PER_SEC=20
SIGNAL_BURST=200

TURN_ENABLED=true
TURN_HOST=
TURN_PORT=3478
TURN_REALM=cricket
TURN_SECRET=
TURN_MIN_PORT=49160
TURN_MAX_PORT=49200
TURN_CRED_TTL=12h
FORCE_RELAY=false
TURN_ALLOW_PRIVATE_PEERS=false
TURN_BIND_IP=true
TURN_MAX_ALLOCS_PER_CRED=16
TURN_MAX_ALLOCS_PER_IP=32
```
