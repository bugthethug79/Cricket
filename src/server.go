package main

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/pion/turn/v4"
)

type Server struct {
	cfg         *Config
	hub         *Hub
	upgrader    websocket.Upgrader
	createLimit *KeyLimiter
	joinLimit   *KeyLimiter
}

func NewServer(cfg *Config, hub *Hub) *Server {
	s := &Server{
		cfg:         cfg,
		hub:         hub,
		createLimit: NewKeyLimiter(10, 5),
		joinLimit:   NewKeyLimiter(30, 15),
	}
	s.upgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			u, err := url.Parse(r.Header.Get("Origin"))
			return err == nil && strings.EqualFold(u.Host, r.Host)
		},
	}
	return s
}

func (s *Server) Handler(static fs.FS) http.Handler {
	mux := http.NewServeMux()
	files := http.FileServerFS(static)

	index := func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, static, "index.html")
	}
	mux.HandleFunc("GET /{$}", index)
	mux.HandleFunc("GET /j", index)
	mux.Handle("GET /assets/", files)
	mux.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("User-agent: *\nDisallow: /\n"))
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("POST /api/rooms", s.handleCreateRoom)
	mux.HandleFunc("GET /ws", s.handleWS)
	return securityHeaders(mux)
}

// securityHeaders keeps every page out of search engines, stops the browser
// from leaking URLs through Referer, and locks scripts to this origin.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()")
		h.Set("Cache-Control", "no-store")
		h.Set("Content-Security-Policy", "default-src 'self'; "+
			"connect-src 'self' wss://"+r.Host+" ws://"+r.Host+"; "+
			"media-src 'self' blob: mediastream:; img-src 'self' data: blob:; "+
			"style-src 'self'; script-src 'self'; object-src 'none'; "+
			"base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"createTokenRequired": s.cfg.CreateToken != "",
		"maxPeers":            s.cfg.MaxPeers,
	})
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if !s.createLimit.Allow(s.clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many rooms created. Wait a minute."})
		return
	}
	var req struct {
		Verifier string `json:"verifier"`
		Token    string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Bad request."})
		return
	}
	if s.cfg.CreateToken != "" &&
		subtle.ConstantTimeCompare([]byte(req.Token), []byte(s.cfg.CreateToken)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Invalid creation token."})
		return
	}
	v, err := base64.RawURLEncoding.DecodeString(req.Verifier)
	if err != nil || len(v) != 32 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Bad verifier."})
		return
	}
	id, err := s.hub.CreateRoom([32]byte(v))
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"room": id})
}

type iceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// iceServers hands each authenticated peer short-lived TURN credentials
// (TURN REST API style) for the TURN server built into this binary.
func (s *Server) iceServers(r *http.Request, peerID string) []iceServer {
	if !s.cfg.TURNEnabled {
		return []iceServer{}
	}
	host := s.cfg.TURNHost
	if host == "" {
		host = r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
			host = "[" + host + "]"
		}
	}
	hp := host + ":" + strconv.Itoa(s.cfg.TURNPort)
	user, pass, err := turn.GenerateLongTermTURNRESTCredentials(s.cfg.TURNSecret, peerID, s.cfg.TURNCredTTL)
	if err != nil {
		return []iceServer{}
	}
	return []iceServer{
		{URLs: []string{"stun:" + hp}},
		{
			URLs:       []string{"turn:" + hp + "?transport=udp", "turn:" + hp + "?transport=tcp"},
			Username:   user,
			Credential: pass,
		},
	}
}
