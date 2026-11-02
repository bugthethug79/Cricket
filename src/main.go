package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("cricket: ")

	cfg := loadConfig()
	hub := NewHub(cfg)

	var turnLimit *turnLimiter
	if cfg.TURNEnabled {
		turnLimit = newTurnLimiter(cfg)
		ts, err := startTURN(cfg, turnLimit)
		if err != nil {
			log.Fatal(err)
		}
		defer ts.Close()
		log.Printf("TURN listening on :%d (udp+tcp), relay %s ports %d-%d",
			cfg.TURNPort, cfg.TURNPublicIP, cfg.TURNMinPort, cfg.TURNMaxPort)
	}

	static, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           NewServer(cfg, hub, turnLimit).Handler(static),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// Request logging is deliberately absent: no record of who joined what.
		ErrorLog: log.New(os.Stderr, "cricket http: ", log.LstdFlags),
	}

	go func() {
		var err error
		if cfg.TLSCert != "" && cfg.TLSKey != "" {
			log.Printf("HTTPS listening on %s", cfg.ListenAddr)
			err = srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			log.Printf("HTTP listening on %s (put a TLS reverse proxy in front: browsers require HTTPS for camera/mic)", cfg.ListenAddr)
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
