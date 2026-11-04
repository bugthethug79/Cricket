package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is read entirely from environment variables so the binary works the
// same way on bare metal and inside Docker.
type Config struct {
	ListenAddr  string
	TLSCert     string
	TLSKey      string
	TrustProxy  bool
	CreateToken string

	MaxPeers         int
	MaxRooms         int
	MaxRoomsPerIP    int
	RoomEmptyTTL     time.Duration
	BanByIP          bool
	CreateRatePerMin int
	CreateBurst      int
	JoinRatePerMin   int
	JoinBurst        int
	IPv6PrefixLen    int
	MaxConns         int
	MaxConnsPerIP    int
	SignalRatePerSec int
	SignalBurst      int

	TURNEnabled          bool
	TURNPublicIP         net.IP
	TURNHost             string
	TURNPort             int
	TURNRealm            string
	TURNSecret           string
	TURNMinPort          int
	TURNMaxPort          int
	TURNCredTTL          time.Duration
	ForceRelay           bool
	AllowPrivatePeers    bool
	TURNBindIP           bool
	TURNMaxAllocsPerCred int
	TURNMaxAllocsPerIP   int
}

func loadConfig() *Config {
	c := &Config{
		ListenAddr:  envStr("LISTEN_ADDR", ":8080"),
		TLSCert:     envStr("TLS_CERT", ""),
		TLSKey:      envStr("TLS_KEY", ""),
		TrustProxy:  envBool("TRUST_PROXY", false),
		CreateToken: envStr("CREATE_TOKEN", ""),

		MaxPeers:         envInt("MAX_PEERS_PER_ROOM", 12),
		MaxRooms:         envInt("MAX_ROOMS", 1000),
		MaxRoomsPerIP:    envInt("MAX_ROOMS_PER_IP", 20),
		RoomEmptyTTL:     envDur("ROOM_EMPTY_TTL", 5*time.Minute),
		BanByIP:          envBool("BAN_BY_IP", true),
		CreateRatePerMin: envInt("CREATE_RATE_PER_MIN", 10),
		CreateBurst:      envInt("CREATE_BURST", 5),
		JoinRatePerMin:   envInt("JOIN_RATE_PER_MIN", 30),
		JoinBurst:        envInt("JOIN_BURST", 15),
		IPv6PrefixLen:    envInt("IPV6_PREFIX_LEN", 64),
		MaxConns:         envInt("MAX_CONNS", 2000),
		MaxConnsPerIP:    envInt("MAX_CONNS_PER_IP", 20),
		SignalRatePerSec: envInt("SIGNAL_RATE_PER_SEC", 20),
		SignalBurst:      envInt("SIGNAL_BURST", 200),

		TURNEnabled:          envBool("TURN_ENABLED", true),
		TURNHost:             envStr("TURN_HOST", ""),
		TURNPort:             envInt("TURN_PORT", 3478),
		TURNRealm:            envStr("TURN_REALM", "cricket"),
		TURNSecret:           envStr("TURN_SECRET", ""),
		TURNMinPort:          envInt("TURN_MIN_PORT", 49160),
		TURNMaxPort:          envInt("TURN_MAX_PORT", 49200),
		TURNCredTTL:          envDur("TURN_CRED_TTL", 12*time.Hour),
		ForceRelay:           envBool("FORCE_RELAY", false),
		AllowPrivatePeers:    envBool("TURN_ALLOW_PRIVATE_PEERS", false),
		TURNBindIP:           envBool("TURN_BIND_IP", true),
		TURNMaxAllocsPerCred: envInt("TURN_MAX_ALLOCS_PER_CRED", 16),
		TURNMaxAllocsPerIP:   envInt("TURN_MAX_ALLOCS_PER_IP", 32),
	}

	if c.TURNSecret == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("generate TURN secret: %v", err)
		}
		c.TURNSecret = hex.EncodeToString(b)
	}

	if c.TURNEnabled {
		ip, err := resolvePublicIP(envStr("PUBLIC_IP", ""))
		if err != nil {
			log.Fatalf("PUBLIC_IP: %v", err)
		}
		c.TURNPublicIP = ip
	}

	if c.TURNMinPort <= 0 || c.TURNMaxPort < c.TURNMinPort || c.TURNMaxPort > 65535 {
		log.Fatalf("invalid TURN port range %d-%d", c.TURNMinPort, c.TURNMaxPort)
	}
	if c.MaxPeers < 2 {
		c.MaxPeers = 2
	}
	if c.MaxRooms < 1 {
		c.MaxRooms = 1
	}
	if c.MaxRoomsPerIP < 0 {
		c.MaxRoomsPerIP = 0
	}
	if c.RoomEmptyTTL <= 0 {
		c.RoomEmptyTTL = 5 * time.Minute
	}
	if c.IPv6PrefixLen < 0 || c.IPv6PrefixLen > 128 {
		c.IPv6PrefixLen = 64
	}
	if c.CreateRatePerMin < 1 {
		c.CreateRatePerMin = 1
	}
	if c.CreateBurst < 1 {
		c.CreateBurst = 1
	}
	if c.JoinRatePerMin < 1 {
		c.JoinRatePerMin = 1
	}
	if c.JoinBurst < 1 {
		c.JoinBurst = 1
	}
	if c.MaxConns < 0 {
		c.MaxConns = 0
	}
	if c.MaxConnsPerIP < 0 {
		c.MaxConnsPerIP = 0
	}
	if c.SignalRatePerSec < 1 {
		c.SignalRatePerSec = 1
	}
	if c.SignalBurst < 1 {
		c.SignalBurst = 1
	}
	if c.TURNMaxAllocsPerCred < 0 {
		c.TURNMaxAllocsPerCred = 0
	}
	if c.TURNMaxAllocsPerIP < 0 {
		c.TURNMaxAllocsPerIP = 0
	}
	return c
}

// resolvePublicIP accepts an IP or a hostname. With no value it falls back to
// the outbound interface address, which is only correct when the server is
// not behind NAT, so it warns loudly.
func resolvePublicIP(v string) (net.IP, error) {
	if v != "" {
		if ip := net.ParseIP(v); ip != nil {
			return ip, nil
		}
		addrs, err := net.LookupIP(v)
		if err != nil {
			return nil, err
		}
		for _, a := range addrs {
			if a.To4() != nil {
				return a, nil
			}
		}
		return nil, fmt.Errorf("%q has no IPv4 address", v)
	}
	conn, err := net.Dial("udp4", "1.1.1.1:53")
	if err != nil {
		return nil, fmt.Errorf("not set and auto-detect failed: %w", err)
	}
	defer conn.Close()
	ip := conn.LocalAddr().(*net.UDPAddr).IP
	log.Printf("WARNING: PUBLIC_IP not set, using %s for TURN relays. Set PUBLIC_IP to your server's public address.", ip)
	return ip, nil
}

func envStr(k, def string) string {
	if v, ok := os.LookupEnv(k); ok {
		return strings.TrimSpace(v)
	}
	return def
}

func envInt(k string, def int) int {
	v := envStr(k, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Fatalf("%s: %v", k, err)
	}
	return n
}

func envBool(k string, def bool) bool {
	v := envStr(k, "")
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		log.Fatalf("%s: %v", k, err)
	}
	return b
}

func envDur(k string, def time.Duration) time.Duration {
	v := envStr(k, "")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Fatalf("%s: %v", k, err)
	}
	return d
}
