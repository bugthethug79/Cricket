package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"

	"golang.org/x/crypto/hkdf"
)

var (
	errInvalidLink  = errors.New("This link is invalid or the room has expired.")
	errCallEnded    = errors.New("This call has ended.")
	errRoomFull     = errors.New("This room is full.")
	errTooManyRooms = errors.New("The server has reached its room limit. Try again later.")
	errBanned       = errors.New("You were banned from this room.")
)

const (
	maxUsedRooms   = 10000
	reconnectGrace = 2 * time.Minute
)

type Hub struct {
	cfg        *Config
	mu         sync.Mutex
	rooms      map[string]*Room
	roomsByKey map[string]int
	used       map[string]struct{}
	usedOrder  []string
}

type Room struct {
	id           string
	verifier     [32]byte
	hostVerifier [32]byte
	hostID       string
	ownerKey     string
	everHosted   bool
	createdAt    time.Time
	mu           sync.Mutex
	peers        map[string]*Peer
	order        []string
	bans         map[string]struct{}
	closed       bool
}

func NewHub(cfg *Config) *Hub {
	h := &Hub{
		cfg:        cfg,
		rooms:      map[string]*Room{},
		roomsByKey: map[string]int{},
		used:       map[string]struct{}{},
	}
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

func authVerifier(key []byte) [32]byte {
	auth := make([]byte, 32)
	if _, err := io.ReadFull(hkdf.New(sha256.New, key, []byte("cricket/v1"), []byte("auth")), auth); err != nil {
		panic(err)
	}
	return sha256.Sum256(auth)
}

func (h *Hub) CreateRoom(ownerKey string) (string, string, string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= h.cfg.MaxRooms {
		return "", "", "", errTooManyRooms
	}
	if h.cfg.MaxRoomsPerIP > 0 && h.roomsByKey[ownerKey] >= h.cfg.MaxRoomsPerIP {
		return "", "", "", errTooManyRooms
	}
	key := randBytes(32)
	host := randBytes(32)
	id := randToken(32)
	h.rooms[id] = &Room{
		id:           id,
		verifier:     authVerifier(key),
		hostVerifier: sha256.Sum256(host),
		ownerKey:     ownerKey,
		peers:        map[string]*Peer{},
		bans:         map[string]struct{}{},
		createdAt:    time.Now(),
	}
	h.roomsByKey[ownerKey]++
	return id, base64.RawURLEncoding.EncodeToString(key), base64.RawURLEncoding.EncodeToString(host), nil
}

func (h *Hub) RoomStatus(id string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[id]; ok {
		r.mu.Lock()
		closed := r.closed
		r.mu.Unlock()
		if !closed {
			return "live"
		}
		return "ended"
	}
	if _, ok := h.used[id]; ok {
		return "ended"
	}
	return "invalid"
}

func (h *Hub) Join(roomID string, authToken, hostToken []byte, p *Peer, welcome func(PeerInfo, []PeerInfo, string) []byte) (*Room, error) {
	h.mu.Lock()
	r := h.rooms[roomID]
	_, ended := h.used[roomID]
	h.mu.Unlock()

	if r == nil {
		if ended {
			return nil, errCallEnded
		}
		sum := sha256.Sum256(authToken)
		subtle.ConstantTimeCompare(sum[:], make([]byte, 32))
		return nil, errInvalidLink
	}

	sum := sha256.Sum256(authToken)
	if subtle.ConstantTimeCompare(sum[:], r.verifier[:]) != 1 {
		return nil, errInvalidLink
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, errCallEnded
	}

	if previous := r.resumableLocked(p.ClientID); previous != nil {
		p.ID = previous.ID
		p.JoinedAt = previous.JoinedAt
		p.room = r
		r.peers[p.ID] = p
		others := make([]PeerInfo, 0, len(r.peers)-1)
		for _, id := range r.order {
			if id != p.ID {
				others = append(others, r.peers[id].info())
			}
		}
		p.enqueue(welcome(p.info(), others, r.hostID))
		r.broadcastLocked(mustJSON(map[string]any{"t": "peer-update", "peer": p.info()}), p.ID)
		return r, nil
	}

	isHost := false
	if r.hostID == "" && len(hostToken) == 32 {
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
		r.everHosted = true
	}

	others := make([]PeerInfo, 0, len(r.peers))
	for _, id := range r.order {
		others = append(others, r.peers[id].info())
	}
	p.room = r
	r.peers[p.ID] = p
	r.order = append(r.order, p.ID)
	p.enqueue(welcome(p.info(), others, r.hostID))
	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-join", "peer": p.info()}), p.ID)
	if oldHost != r.hostID {
		r.broadcastLocked(hostMessage(r.hostID), "")
	}
	return r, nil
}

func (r *Room) resumableLocked(clientID string) *Peer {
	if clientID == "" {
		return nil
	}
	for _, p := range r.peers {
		if p.ClientID == clientID && !p.online {
			return p
		}
	}
	return nil
}

func (r *Room) Leave(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.leaveLocked(p)
}

func (r *Room) leaveLocked(p *Peer) {
	if r.peers[p.ID] != p {
		return
	}
	delete(r.peers, p.ID)
	for i, id := range r.order {
		if id == p.ID {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-leave", "id": p.ID}), "")
	if r.hostID != p.ID {
		return
	}
	r.hostID = ""
	r.hostVerifier = [32]byte{}
	if len(r.peers) == 0 {
		return
	}
	var next *Peer
	for _, id := range r.order {
		if r.peers[id].online {
			next = r.peers[id]
			break
		}
	}
	if next == nil {
		next = r.peers[r.order[0]]
	}
	r.hostID = next.ID
	r.broadcastLocked(hostMessage(next.ID), "")
}

func (r *Room) Disconnect(p *Peer) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.peers[p.ID] != p {
		return false
	}
	if r.closed || p.kicked {
		r.leaveLocked(p)
		return true
	}
	p.online = false
	p.goneAt = time.Now()
	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-update", "peer": p.info()}), p.ID)
	return false
}

func (r *Room) Promote(hostID, targetID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.hostID != hostID || targetID == "" || targetID == hostID {
		return
	}
	if _, ok := r.peers[targetID]; !ok {
		return
	}
	r.hostID = targetID
	r.hostVerifier = [32]byte{}
	r.broadcastLocked(hostMessage(targetID), "")
}

func (r *Room) Moderate(hostID, targetID, action string, on bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.hostID != hostID || targetID == "" || targetID == hostID {
		return
	}
	p, ok := r.peers[targetID]
	if !ok {
		return
	}
	p.enqueue(mustJSON(map[string]any{"t": "moderate", "action": action, "on": on}))
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
		if p.online {
			p.kick(4001, "kicked")
		} else {
			r.leaveLocked(p)
		}
		return
	}
	if p.ClientID != "" {
		r.bans["c:"+p.ClientID] = struct{}{}
	}
	if banIP && p.IP != "" && p.IP != hostIP {
		r.bans["i:"+p.IP] = struct{}{}
	}
	if p.online {
		p.kick(4004, "banned")
	} else {
		r.leaveLocked(p)
	}
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

func (h *Hub) FinishIfEmpty(r *Room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.peers) > 0 || r.closed {
		return
	}
	r.closed = true
	h.dropRoomLocked(r.id, r)
	h.markUsedLocked(r.id)
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

func (h *Hub) markUsedLocked(id string) {
	if _, ok := h.used[id]; ok {
		return
	}
	h.used[id] = struct{}{}
	h.usedOrder = append(h.usedOrder, id)
	if len(h.usedOrder) > maxUsedRooms {
		oldest := h.usedOrder[0]
		h.usedOrder = h.usedOrder[1:]
		delete(h.used, oldest)
	}
}

func (r *Room) broadcastLocked(msg []byte, except string) {
	for id, p := range r.peers {
		if id != except && p.online {
			p.enqueue(msg)
		}
	}
}

func (r *Room) SendTo(id string, msg []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.peers[id]; ok && p.online {
		p.enqueue(msg)
	}
}

func (r *Room) UpdateState(p *Peer, s PeerState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p.State = s
	r.broadcastLocked(mustJSON(map[string]any{"t": "peer-update", "peer": p.info()}), p.ID)
}

func (h *Hub) janitor() {
	for range time.Tick(5 * time.Second) {
		now := time.Now()
		h.mu.Lock()
		for id, r := range h.rooms {
			r.mu.Lock()
			if r.closed {
				r.mu.Unlock()
				continue
			}
			for _, p := range r.peers {
				if !p.online && now.Sub(p.goneAt) > reconnectGrace {
					r.leaveLocked(p)
				}
			}
			if r.everHosted && len(r.peers) == 0 {
				r.closed = true
				h.dropRoomLocked(id, r)
				h.markUsedLocked(id)
				r.mu.Unlock()
				continue
			}
			if !r.everHosted && now.Sub(r.createdAt) > h.cfg.RoomEmptyTTL {
				r.closeLocked(4003, "room-expired")
				h.dropRoomLocked(id, r)
				h.markUsedLocked(id)
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
