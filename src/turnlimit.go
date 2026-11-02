package main

import (
	"net"
	"strings"
	"sync"
	"time"
)

type turnCred struct {
	ip     net.IP
	expiry time.Time
}

type turnLimiter struct {
	mu         sync.Mutex
	bindIP     bool
	maxPerCred int
	maxPerIP   int
	credIP     map[string]turnCred
	perCred    map[string]int
	perIP      map[string]int
}

func newTurnLimiter(cfg *Config) *turnLimiter {
	return &turnLimiter{
		bindIP:     cfg.TURNBindIP,
		maxPerCred: cfg.TURNMaxAllocsPerCred,
		maxPerIP:   cfg.TURNMaxAllocsPerIP,
		credIP:     map[string]turnCred{},
		perCred:    map[string]int{},
		perIP:      map[string]int{},
	}
}

func (l *turnLimiter) register(peerID, ip string, expiry time.Time) {
	if !l.bindIP {
		return
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.credIP[peerID] = turnCred{ip: parsed, expiry: expiry}
	if len(l.credIP) > 4096 {
		now := time.Now()
		for id, c := range l.credIP {
			if now.After(c.expiry) {
				delete(l.credIP, id)
			}
		}
	}
}

func turnPeerID(username string) string {
	if i := strings.LastIndexByte(username, ':'); i >= 0 {
		return username[i+1:]
	}
	return username
}

func addrKey(addr net.Addr) string {
	if addr == nil {
		return ""
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return addr.String()
	}
	return host
}

func (l *turnLimiter) quota(username, realm string, srcAddr net.Addr) bool {
	peerID := turnPeerID(username)
	ip := addrKey(srcAddr)
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.bindIP {
		c, ok := l.credIP[peerID]
		if !ok {
			return false
		}
		if now.After(c.expiry) {
			delete(l.credIP, peerID)
			return false
		}
		src := net.ParseIP(ip)
		if src == nil || !src.Equal(c.ip) {
			return false
		}
	}
	if l.maxPerCred > 0 && l.perCred[peerID] >= l.maxPerCred {
		return false
	}
	if l.maxPerIP > 0 && l.perIP[ip] >= l.maxPerIP {
		return false
	}
	return true
}

func (l *turnLimiter) allocationCreated(srcAddr, dstAddr net.Addr, protocol, username, realm string, relayAddr net.Addr, requestedPort int) {
	peerID := turnPeerID(username)
	ip := addrKey(srcAddr)
	l.mu.Lock()
	l.perCred[peerID]++
	l.perIP[ip]++
	l.mu.Unlock()
}

func (l *turnLimiter) allocationDeleted(srcAddr, dstAddr net.Addr, protocol, username, realm string) {
	peerID := turnPeerID(username)
	ip := addrKey(srcAddr)
	l.mu.Lock()
	decFunc(l.perCred, peerID)
	decFunc(l.perIP, ip)
	l.mu.Unlock()
}

func decFunc(m map[string]int, k string) {
	if m[k] > 1 {
		m[k]--
	} else {
		delete(m, k)
	}
}
