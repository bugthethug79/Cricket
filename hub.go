package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

var (
	// errInvalidLink covers both "no such room" and "wrong key" so the
	// server never reveals whether a room id exists.
	errInvalidLink  = errors.New("This link is invalid or the room has expired.")
	errRoomFull     = errors.New("This room is full.")
	errTooManyRooms = errors.New("The server has reached its room limit. Try again later.")
)

// Hub holds every live room in memory. Nothing is ever written to disk:
// restarting the server destroys all rooms.
type Hub struct {
	cfg   *Config
	mu    sync.Mutex
	rooms map[string]*Room
}

// Room stores only a SHA-256 verifier of the client-derived auth token. The
// raw link key never reaches the server (it lives in the URL fragment), and
// chat is encrypted with a separate key derived from it in the browser.
type Room struct {
	id         string
	verifier   [32]byte
	mu         sync.Mutex
	peers      map[string]*Peer
	order      []string // join order, for a stable participant list
	emptySince time.Time
	closed     bool
}

func NewHub(cfg *Config) *Hub {
	h := &Hub{cfg: cfg, rooms: map[string]*Room{}}
	go h.janitor()
	return h
}

func randToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (h *Hub) CreateRoom(verifier [32]byte) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= h.cfg.MaxRooms {
		return "", errTooManyRooms
	}
	id := randToken(32)
	h.rooms[id] = &Room{
		id:         id,
		verifier:   verifier,
		peers:      map[string]*Peer{},
		emptySince: time.Now(),
	}
	return id, nil
}

// Join authenticates the peer, adds it to the room and queues the welcome
// message (built from the current member list) before any broadcast can reach
// the new peer, so its view of the room is always consistent.
func (h *Hub) Join(roomID string, authToken []byte, p *Peer, welcome func([]PeerInfo) []byte) (*Room, error) {
	h.mu.Lock()
	r := h.rooms[roomID]
	h.mu.Unlock()

	sum := sha256.Sum256(authToken)
	if r == nil {
		// Burn comparable time so a missing room looks like a bad key.
		subtle.ConstantTimeCompare(sum[:], make([]byte, 32))
		return nil, errInvalidLink
	}
	if subtle.ConstantTimeCompare(sum[:], r.verifier[:]) != 1 {
		return nil, errInvalidLink
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, errInvalidLink
	}
	if len(r.peers) >= h.cfg.MaxPeers {
		return nil, errRoomFull
	}

	others := make([]PeerInfo, 0, len(r.peers))
	for _, id := range r.order {
		others = append(others, r.peers[id].info())
	}
	p.room = r
	p.enqueue(welcome(others))

	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-join", "peer": p.info()}), "")
	r.peers[p.ID] = p
	r.order = append(r.order, p.ID)
	r.emptySince = time.Time{}
	return r, nil
}

func (r *Room) Leave(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.peers[p.ID]; !ok {
		return
	}
	delete(r.peers, p.ID)
	for i, id := range r.order {
		if id == p.ID {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
	if len(r.peers) == 0 {
		r.emptySince = time.Now()
	}
	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-leave", "id": p.ID}), "")
}

func (r *Room) Broadcast(msg []byte, except string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.broadcastLocked(msg, except)
}

func (r *Room) broadcastLocked(msg []byte, except string) {
	for id, p := range r.peers {
		if id != except {
			p.enqueue(msg)
		}
	}
}

func (r *Room) SendTo(id string, msg []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.peers[id]; ok {
		p.enqueue(msg)
	}
}

func (r *Room) UpdateState(p *Peer, s PeerState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p.State = s
	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-update", "peer": p.info()}), p.ID)
}

// janitor deletes rooms that have had nobody in them for RoomIdleTTL.
func (h *Hub) janitor() {
	for range time.Tick(time.Minute) {
		now := time.Now()
		h.mu.Lock()
		for id, r := range h.rooms {
			r.mu.Lock()
			if len(r.peers) == 0 && now.Sub(r.emptySince) > h.cfg.RoomIdleTTL {
				r.closed = true
				delete(h.rooms, id)
			}
			r.mu.Unlock()
		}
		h.mu.Unlock()
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
