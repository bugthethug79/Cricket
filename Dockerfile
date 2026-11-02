# ---- build ----
FROM golang:1.25-alpine AS build
RUN apk add --no-cache make
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN make build \
 && cp out/cricket-* /cricket-bin

# ---- run ----
# One static binary: web app + signaling + built-in STUN/TURN server.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /cricket-bin /cricket

# 8080/tcp  HTTP (put a TLS reverse proxy in front, see docker-compose.yml)
# 3478      STUN/TURN, udp + tcp
# 49160-49200/udp  TURN relay ports (TURN_MIN_PORT..TURN_MAX_PORT)
EXPOSE 8080/tcp 3478/udp 3478/tcp 49160-49200/udp

USER nonroot:nonroot
ENTRYPOINT ["/cricket"]
