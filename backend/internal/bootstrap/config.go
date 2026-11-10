// Package bootstrap owns process configuration and lifecycle, not business rules.
package bootstrap

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"
)

type Config struct {
	APIAddr, OpsAddr, DBPath        string
	Origins                         []string
	LogLevel                        slog.Level
	RequestTimeout, ShutdownTimeout time.Duration
}

func Load(get func(string) string) (Config, error) {
	value := func(key, fallback string) string {
		if v := get(key); v != "" {
			return v
		}
		return fallback
	}
	c := Config{APIAddr: value("API_ADDR", "127.0.0.1:4000"), OpsAddr: value("OPS_ADDR", "127.0.0.1:4001"), DBPath: value("DB_PATH", "data/hadaf.db"), Origins: strings.Split(value("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"), ","), RequestTimeout: 5 * time.Second, ShutdownTimeout: 10 * time.Second}
	if c.OpsAddr == "off" {
		c.OpsAddr = ""
	} else {
		host, _, err := net.SplitHostPort(c.OpsAddr)
		if err != nil {
			return c, fmt.Errorf("OPS_ADDR must be a loopback address: %w", err)
		}
		if host != "localhost" {
			ip := net.ParseIP(host)
			if ip == nil || !ip.IsLoopback() {
				return c, fmt.Errorf("OPS_ADDR must bind only to loopback")
			}
		}
	}
	if err := c.LogLevel.UnmarshalText([]byte(value("LOG_LEVEL", "info"))); err != nil {
		return c, fmt.Errorf("invalid LOG_LEVEL: %w", err)
	}
	return c, nil
}
func NewID() (string, error) {
	var data [16]byte
	_, err := rand.Read(data[:])
	return hex.EncodeToString(data[:]), err
}
