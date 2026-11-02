package main

import (
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
