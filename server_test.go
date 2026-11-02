package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"
)

func testServer(t *testing.T) *httptest.Server {
	cfg := &Config{MaxPeers: 3, MaxRooms: 10, RoomIdleTTL: time.Hour, TURNSecret: "x"}
	static := fstest.MapFS{"index.html": {Data: []byte("<html>")}}
	ts := httptest.NewServer(NewServer(cfg, NewHub(cfg)).Handler(static))
	t.Cleanup(ts.Close)
	return ts
}

func createRoom(t *testing.T, ts *httptest.Server, auth []byte) string {
	v := sha256.Sum256(auth)
	body, _ := json.Marshal(map[string]string{"verifier": base64.RawURLEncoding.EncodeToString(v[:])})
	res, err := http.Post(ts.URL+"/api/rooms", "application/json", bytes.NewReader(body))
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("create room: %v %v", err, res.Status)
	}
	var out struct{ Room string }
	json.NewDecoder(res.Body).Decode(&out)
	if len(out.Room) < 40 {
		t.Fatalf("room id too short: %q", out.Room)
	}
	return out.Room
}

func dial(t *testing.T, ts *httptest.Server, room string, auth []byte, name string) *websocket.Conn {
	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, _, err := websocket.DefaultDialer.Dial(u, http.Header{"Origin": {ts.URL}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	c.WriteJSON(map[string]string{"t": "join", "room": room, "auth": base64.RawURLEncoding.EncodeToString(auth), "name": name})
	return c
}

func read(t *testing.T, c *websocket.Conn) map[string]any {
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var m map[string]any
	if err := c.ReadJSON(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestRoomFlow(t *testing.T) {
	ts := testServer(t)
	auth := bytes.Repeat([]byte{7}, 32)
	room := createRoom(t, ts, auth)

	// Wrong key and unknown room both get the same generic error.
	for _, tc := range []struct {
		room string
		auth []byte
	}{{room, bytes.Repeat([]byte{8}, 32)}, {"nope", auth}} {
		bad := dial(t, ts, tc.room, tc.auth, "eve")
		if m := read(t, bad); m["t"] != "error" || m["msg"] != errInvalidLink.Error() {
			t.Fatalf("expected invalid link error, got %v", m)
		}
	}

	a := dial(t, ts, room, auth, "alice")
	if m := read(t, a); m["t"] != "welcome" || len(m["peers"].([]any)) != 0 {
		t.Fatalf("alice welcome: %v", m)
	}

	b := dial(t, ts, room, auth, "bob")
	wb := read(t, b)
	if wb["t"] != "welcome" || len(wb["peers"].([]any)) != 1 {
		t.Fatalf("bob welcome should list alice: %v", wb)
	}
	if m := read(t, a); m["t"] != "peer-join" {
		t.Fatalf("alice should see bob join: %v", m)
	}

	// Chat is relayed to people currently in the room only.
	a.WriteJSON(map[string]any{"t": "chat", "data": map[string]string{"iv": "x", "ct": "y"}})
	if m := read(t, b); m["t"] != "chat" || m["name"] != "alice" {
		t.Fatalf("bob should get chat: %v", m)
	}

	c := dial(t, ts, room, auth, "carol")
	if m := read(t, c); m["t"] != "welcome" || len(m["peers"].([]any)) != 2 {
		t.Fatalf("carol welcome: %v", m)
	}
	read(t, a) // peer-join
	read(t, b) // peer-join
	// Carol must not receive the earlier chat: the next thing she sees is a new state update.
	a.WriteJSON(map[string]any{"t": "state", "state": map[string]bool{"mic": true}})
	if m := read(t, c); m["t"] != "peer-update" {
		t.Fatalf("carol got history or wrong message: %v", m)
	}

	// Room is full at 3.
	d := dial(t, ts, room, auth, "dave")
	if m := read(t, d); m["t"] != "error" || m["msg"] != errRoomFull.Error() {
		t.Fatalf("expected room full: %v", m)
	}

	// Leaving is broadcast.
	b.Close()
	if m := read(t, a); m["t"] != "peer-update" && m["t"] != "peer-leave" {
		t.Fatalf("unexpected: %v", m)
	}
}

func TestNoIndexHeaders(t *testing.T) {
	ts := testServer(t)
	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Header.Get("X-Robots-Tag"), "noindex") || res.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("missing privacy headers: %v", res.Header)
	}
}
