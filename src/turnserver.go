package main

import (
	"fmt"
	"net"

	"github.com/pion/logging"
	"github.com/pion/turn/v4"
)

// startTURN runs a STUN/TURN server (UDP and TCP on the same port) inside
// this process. Credentials are the time-limited HMAC ones handed out over
// the authenticated signaling socket, so only people in a room can relay.
func startTURN(cfg *Config) (*turn.Server, error) {
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
		return !(peer.IsLoopback() || peer.IsPrivate() || peer.IsUnspecified() ||
			peer.IsLinkLocalUnicast() || peer.IsLinkLocalMulticast() || peer.IsMulticast())
	}

	logger := logging.NewDefaultLoggerFactory()
	return turn.NewServer(turn.ServerConfig{
		Realm:         cfg.TURNRealm,
		AuthHandler:   turn.LongTermTURNRESTAuthHandler(cfg.TURNSecret, logger.NewLogger("turn")),
		LoggerFactory: logger,
		PacketConnConfigs: []turn.PacketConnConfig{
			{PacketConn: udp, RelayAddressGenerator: relay, PermissionHandler: permit},
		},
		ListenerConfigs: []turn.ListenerConfig{
			{Listener: tcp, RelayAddressGenerator: relay, PermissionHandler: permit},
		},
	})
}
