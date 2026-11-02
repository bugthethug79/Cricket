package main

import (
	"fmt"
	"net"

	"github.com/pion/logging"
	"github.com/pion/turn/v4"
)

var blockedPeerNets = func() []*net.IPNet {
	cidrs := []string{
		"0.0.0.0/8",
		"10.0.0.0/8",
		"100.64.0.0/10",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"172.16.0.0/12",
		"192.0.0.0/24",
		"192.0.2.0/24",
		"192.168.0.0/16",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"224.0.0.0/4",
		"240.0.0.0/4",
		"::/128",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
		"ff00::/8",
	}
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, n, err := net.ParseCIDR(cidr)
		if err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}()

func publicPeer(ip net.IP) bool {
	for _, n := range blockedPeerNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// startTURN runs a STUN/TURN server (UDP and TCP on the same port) inside
// this process. Credentials are the time-limited HMAC ones handed out over
// the authenticated signaling socket, so only people in a room can relay.
func startTURN(cfg *Config, limiter *turnLimiter) (*turn.Server, error) {
	addr := fmt.Sprintf("0.0.0.0:%d", cfg.TURNPort)
	udp, err := net.ListenPacket("udp4", addr)
	if err != nil {
		return nil, fmt.Errorf("TURN udp listen: %w", err)
	}
	tcp, err := net.Listen("tcp4", addr)
	if err != nil {
		udp.Close()
		return nil, fmt.Errorf("TURN tcp listen: %w", err)
	}

	relay := &turn.RelayAddressGeneratorPortRange{
		RelayAddress: cfg.TURNPublicIP,
		Address:      "0.0.0.0",
		MinPort:      uint16(cfg.TURNMinPort),
		MaxPort:      uint16(cfg.TURNMaxPort),
	}

	// Refuse to relay into loopback/private networks so the TURN server
	// can't be used to reach services on the host's LAN.
	permit := func(_ net.Addr, peer net.IP) bool {
		if cfg.AllowPrivatePeers || peer.Equal(cfg.TURNPublicIP) {
			return true
		}
		return publicPeer(peer)
	}

	logger := logging.NewDefaultLoggerFactory()
	return turn.NewServer(turn.ServerConfig{
		Realm:        cfg.TURNRealm,
		AuthHandler:  turn.LongTermTURNRESTAuthHandler(cfg.TURNSecret, logger.NewLogger("turn")),
		QuotaHandler: limiter.quota,
		EventHandler: turn.EventHandler{
			OnAllocationCreated: limiter.allocationCreated,
			OnAllocationDeleted: limiter.allocationDeleted,
		},
		LoggerFactory: logger,
		PacketConnConfigs: []turn.PacketConnConfig{
			{PacketConn: udp, RelayAddressGenerator: relay, PermissionHandler: permit},
		},
		ListenerConfigs: []turn.ListenerConfig{
			{Listener: tcp, RelayAddressGenerator: relay, PermissionHandler: permit},
		},
	})
}
