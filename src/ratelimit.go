package main

import (
	"net"
	"strconv"
	"sync"
	"time"
)

// bucket is a plain token bucket; callers hold whatever lock protects it.
type bucket struct {
	tokens float64
	last   time.Time
}

func (b *bucket) allow(rate, burst float64, now time.Time) bool {
	if b.last.IsZero() {
		b.tokens = burst
	} else {
		b.tokens += now.Sub(b.last).Seconds() * rate
		if b.tokens > burst {
			b.tokens = burst
		}
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// KeyLimiter rate limits by an arbitrary key (usually a client IP).
type KeyLimiter struct {
	mu    sync.Mutex
	m     map[string]*bucket
	rate  float64
	burst float64
}

func NewKeyLimiter(perMinute, burst float64) *KeyLimiter {
	l := &KeyLimiter{m: map[string]*bucket{}, rate: perMinute / 60, burst: burst}
	go func() {
		for range time.Tick(5 * time.Minute) {
			l.mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute)
			for k, b := range l.m {
				if b.last.Before(cutoff) {
					delete(l.m, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

func (l *KeyLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.m[key]
	if !ok {
		b = &bucket{}
		l.m[key] = b
	}
	return b.allow(l.rate, l.burst, time.Now())
}

func prefixKey(ipStr string, v6Bits int) string {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return ipStr
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	if v6Bits < 0 || v6Bits > 128 {
		v6Bits = 64
	}
	return ip.Mask(net.CIDRMask(v6Bits, 128)).String() + "/" + strconv.Itoa(v6Bits)
}

type connLimiter struct {
	mu        sync.Mutex
	max       int
	maxPerKey int
	total     int
	per       map[string]int
}

func newConnLimiter(max, maxPerKey int) *connLimiter {
	return &connLimiter{max: max, maxPerKey: maxPerKey, per: map[string]int{}}
}

func (c *connLimiter) Allow(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.max > 0 && c.total >= c.max {
		return false
	}
	if c.maxPerKey > 0 && c.per[key] >= c.maxPerKey {
		return false
	}
	c.total++
	c.per[key]++
	return true
}

func (c *connLimiter) Release(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.total > 0 {
		c.total--
	}
	if c.per[key] > 1 {
		c.per[key]--
	} else {
		delete(c.per, key)
	}
}
