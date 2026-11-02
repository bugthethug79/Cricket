package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 25 * time.Second
	joinWait       = 10 * time.Second
	maxMessageSize = 64 << 10 // SDP offers with many tracks can reach ~20 KB
	maxChatSize    = 12 << 10 // encrypted chat payload
	maxNameLen     = 32
)

type PeerState struct {
	Mic          bool   `json:"mic"`
	Cam          bool   `json:"cam"`
	Screen       bool   `json:"screen"`
	ScreenStream string `json:"screenStream,omitempty"`
}

type PeerInfo struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	State    PeerState `json:"state"`
	JoinedAt int64     `json:"joinedAt"`
}

type Peer struct {
	ID       string
	Name     string
	State    PeerState // guarded by room.mu
	JoinedAt time.Time

	room      *Room
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once

	msgLimit  bucket
	chatLimit bucket
}

func (p *Peer) info() PeerInfo {
	return PeerInfo{ID: p.ID, Name: p.Name, State: p.State, JoinedAt: p.JoinedAt.UnixMilli()}
}

// enqueue never blocks: a client too slow to drain its queue is dropped
// rather than stalling the whole room.
func (p *Peer) enqueue(msg []byte) {
	select {
	case p.send <- msg:
	case <-p.done:
	default:
		p.close()
	}
}

func (p *Peer) close() {
	p.closeOnce.Do(func() {
		close(p.done)
		p.conn.Close()
	})
}

func (p *Peer) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case msg := <-p.send:
			p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := p.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				p.close()
				return
			}
		case <-ticker.C:
			p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := p.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				p.close()
				return
			}
		case <-p.done:
			return
		}
	}
}

type inMsg struct {
	T     string          `json:"t"`
	Room  string          `json:"room,omitempty"`
	Auth  string          `json:"auth,omitempty"`
	Name  string          `json:"name,omitempty"`
	To    string          `json:"to,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
	State *PeerState      `json:"state,omitempty"`
}

func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '​' || r == '‮' {
			return -1
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > maxNameLen {
		s = string(r[:maxNameLen])
	}
	if s == "" {
		s = "Guest"
	}
	return s
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.joinLimit.Allow(s.clientIP(r)) {
		http.Error(w, "too many requests", http.StatusTooManyRequests)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(joinWait))

	fail := func(msg string) {
		conn.SetWriteDeadline(time.Now().Add(writeWait))
		conn.WriteMessage(websocket.TextMessage, mustJSON(map[string]string{"t": "error", "msg": msg}))
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, ""))
		conn.Close()
	}

	var join inMsg
	if err := conn.ReadJSON(&join); err != nil || join.T != "join" {
		fail("Expected join message.")
		return
	}
	token, err := base64.RawURLEncoding.DecodeString(join.Auth)
	if err != nil || len(token) != 32 || len(join.Room) > 64 {
		fail(errInvalidLink.Error())
		return
	}

	p := &Peer{
		ID:       randToken(12),
		Name:     cleanName(join.Name),
		JoinedAt: time.Now(),
		conn:     conn,
		send:     make(chan []byte, 256),
		done:     make(chan struct{}),
	}
	if join.State != nil {
		p.State = sanitizeState(*join.State)
	}

	room, err := s.hub.Join(join.Room, token, p, func(others []PeerInfo) []byte {
		return mustJSON(map[string]any{
			"t":          "welcome",
			"self":       p.info(),
			"peers":      others,
			"ice":        s.iceServers(r, p.ID),
			"forceRelay": s.cfg.ForceRelay,
			"maxPeers":   s.cfg.MaxPeers,
		})
	})
	if err != nil {
		fail(err.Error())
		return
	}

	go p.writePump()
	defer func() {
		room.Leave(p)
		p.close()
	}()

	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var m inMsg
		if err := conn.ReadJSON(&m); err != nil {
			return
		}
		now := time.Now()
		// ICE candidates arrive in bursts, so the general limit is generous.
		if !p.msgLimit.allow(50, 300, now) {
			return
		}
		switch m.T {
		case "signal":
			if m.To == "" || m.To == p.ID || len(m.Data) == 0 {
				continue
			}
			room.SendTo(m.To, mustJSON(map[string]any{"t": "signal", "from": p.ID, "data": m.Data}))
		case "chat":
			if len(m.Data) == 0 || len(m.Data) > maxChatSize || !p.chatLimit.allow(3, 15, now) {
				continue
			}
			room.Broadcast(mustJSON(map[string]any{
				"t": "chat", "from": p.ID, "name": p.Name, "ts": now.UnixMilli(), "data": m.Data,
			}), p.ID)
		case "state":
			if m.State != nil {
				room.UpdateState(p, sanitizeState(*m.State))
			}
		}
	}
}

func sanitizeState(s PeerState) PeerState {
	if len(s.ScreenStream) > 64 || !s.Screen {
		s.ScreenStream = ""
	}
	return s
}
