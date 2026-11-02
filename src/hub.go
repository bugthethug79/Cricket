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
	errBanned       = errors.New("You were banned from this room.")
)

// Hub holds every live room in memory. Nothing is ever written to disk:
// restarting the server destroys all rooms.
type Hub struct {
	cfg        *Config
	mu         sync.Mutex
	rooms      map[string]*Room
	roomsByKey map[string]int
}

// Room stores only a SHA-256 verifier of the client-derived auth token. The
// raw link key never reaches the server (it lives in the URL fragment), and
// chat is encrypted with a separate key derived from it in the browser.
type Room struct {
	id            string
	verifier      [32]byte
	hostVerifier  [32]byte
	hostID        string
	ownerKey      string
	everHosted    bool
	createdAt     time.Time
	mu            sync.Mutex
	peers         map[string]*Peer
	order         []string
	bans          map[string]struct{}
	emptySince    time.Time
	hostLeftSince time.Time
	closed        bool
}

func NewHub(cfg *Config) *Hub {
	h := &Hub{cfg: cfg, rooms: map[string]*Room{}, roomsByKey: map[string]int{}}
	go h.janitor()
	return h
}

func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func randToken(n int) string {
	return base64.RawURLEncoding.EncodeToString(randBytes(n))
}

func (h *Hub) CreateRoom(verifier [32]byte, ownerKey string) (string, string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= h.cfg.MaxRooms {
		return "", "", errTooManyRooms
	}
	if h.cfg.MaxRoomsPerIP > 0 && h.roomsByKey[ownerKey] >= h.cfg.MaxRoomsPerIP {
		return "", "", errTooManyRooms
	}
	hostBytes := randBytes(32)
	id := randToken(32)
	h.rooms[id] = &Room{
		id:           id,
		verifier:     verifier,
		hostVerifier: sha256.Sum256(hostBytes),
		ownerKey:     ownerKey,
		peers:        map[string]*Peer{},
		bans:         map[string]struct{}{},
		createdAt:    time.Now(),
		emptySince:   time.Now(),
	}
	h.roomsByKey[ownerKey]++
	return id, base64.RawURLEncoding.EncodeToString(hostBytes), nil
}

// Join authenticates the peer, adds it to the room and queues the welcome
// message (built from the current member list) before any broadcast can reach
// the new peer, so its view of the room is always consistent.
func (h *Hub) Join(roomID string, authToken, hostToken []byte, p *Peer, welcome func(PeerInfo, []PeerInfo, string) []byte) (*Room, error) {
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

	isHost := false
	if len(hostToken) == 32 {
		hostSum := sha256.Sum256(hostToken)
		isHost = subtle.ConstantTimeCompare(hostSum[:], r.hostVerifier[:]) == 1
	}
	if !isHost && r.bannedLocked(p.ClientID, p.IP) {
		return nil, errBanned
	}
	if !isHost && len(r.peers) >= h.cfg.MaxPeers {
		return nil, errRoomFull
	}

	oldHost := r.hostID
	if isHost {
		r.hostID = p.ID
		r.hostLeftSince = time.Time{}
		r.everHosted = true
	}

	others := make([]PeerInfo, 0, len(r.peers))
	for _, id := range r.order {
		others = append(others, r.peers[id].info())
	}
	p.room = r
	p.enqueue(welcome(p.info(), others, r.hostID))

	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-join", "peer": p.info()}), "")
	r.peers[p.ID] = p
	r.order = append(r.order, p.ID)
	if oldHost != r.hostID {
		r.broadcastLocked(hostMessage(r.hostID), "")
	}
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
	if r.hostID == p.ID {
		r.hostID = ""
		r.hostLeftSince = time.Now()
		r.broadcastLocked(hostMessage(""), "")
	}
}

func (r *Room) Kick(hostID, hostIP, targetID string, ban, banIP bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.hostID != hostID || targetID == "" || targetID == hostID {
		return
	}
	p, ok := r.peers[targetID]
	if !ok {
		return
	}
	if !ban {
		p.kick(4001, "kicked")
		return
	}
	if p.ClientID != "" {
		r.bans["c:"+p.ClientID] = struct{}{}
	}
	if banIP && p.IP != "" && p.IP != hostIP {
		r.bans["i:"+p.IP] = struct{}{}
	}
	p.kick(4004, "banned")
}

func (r *Room) bannedLocked(clientID, ip string) bool {
	if clientID != "" {
		if _, ok := r.bans["c:"+clientID]; ok {
			return true
		}
	}
	if ip != "" {
		if _, ok := r.bans["i:"+ip]; ok {
			return true
		}
	}
	return false
}

func hostMessage(id string) []byte {
	return mustJSON(map[string]string{"t": "host", "id": id})
}

func (r *Room) closeLocked(code int, text string) {
	if r.closed {
		return
	}
	r.closed = true
	for _, p := range r.peers {
		p.kick(code, text)
	}
}

func (h *Hub) EndRoom(roomID, hostID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[roomID]
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.hostID != hostID {
		return
	}
	r.closeLocked(4002, "host-left")
	h.dropRoomLocked(roomID, r)
}

func (h *Hub) dropRoomLocked(id string, r *Room) {
	delete(h.rooms, id)
	if r.ownerKey == "" {
		return
	}
	if h.roomsByKey[r.ownerKey] > 1 {
		h.roomsByKey[r.ownerKey]--
	} else {
		delete(h.roomsByKey, r.ownerKey)
	}
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
	for range time.Tick(5 * time.Second) {
		now := time.Now()
		h.mu.Lock()
		for id, r := range h.rooms {
			r.mu.Lock()
			if !r.everHosted && now.Sub(r.createdAt) > h.cfg.RoomEmptyTTL {
				r.closeLocked(4003, "room-expired")
				h.dropRoomLocked(id, r)
				r.mu.Unlock()
				continue
			}
			if !r.hostLeftSince.IsZero() && now.Sub(r.hostLeftSince) > h.cfg.HostGrace {
				r.closeLocked(4002, "host-left")
				h.dropRoomLocked(id, r)
				r.mu.Unlock()
				continue
			}
			if len(r.peers) == 0 && now.Sub(r.emptySince) > h.cfg.RoomIdleTTL {
				r.closeLocked(4003, "room-expired")
				h.dropRoomLocked(id, r)
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
