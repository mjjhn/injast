package bootstrap

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/application"
	"io"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestConfigAndID(t *testing.T) {
	cfg, err := Load(func(string) string { return "" })
	if err != nil || cfg.APIAddr != "127.0.0.1:4000" || cfg.OpsAddr != "127.0.0.1:4001" || cfg.LogLevel != slog.LevelInfo {
		t.Fatal(cfg, err)
	}
	for _, addr := range []string{"0.0.0.0:4001", ":4001", "example.com:4001", "invalid"} {
		if _, err := Load(func(k string) string {
			if k == "OPS_ADDR" {
				return addr
			}
			return ""
		}); err == nil {
			t.Fatal("unsafe ops", addr)
		}
	}
	for _, addr := range []string{"off", "localhost:4001", "[::1]:4001", "127.0.0.2:4001"} {
		if _, err := Load(func(k string) string {
			if k == "OPS_ADDR" {
				return addr
			}
			return ""
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := Load(func(k string) string {
		if k == "LOG_LEVEL" {
			return "garbage"
		}
		return ""
	}); err == nil {
		t.Fatal("bad log level")
	}
	a, err := NewID()
	b, _ := NewID()
	if err != nil || len(a) != 32 || a == b {
		t.Fatal(a, b, err)
	}
}
func freeAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	return address
}
func TestLifecycleAndStartupFailures(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	cfg, _ := Load(func(string) string { return "" })
	cfg.APIAddr = freeAddress(t)
	cfg.OpsAddr = freeAddress(t)
	cfg.DBPath = filepath.Join(t.TempDir(), "data.db")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, cfg, logger) }()
	client := http.Client{Timeout: time.Second}
	ready := false
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); {
		resp, err := client.Get("http://" + cfg.OpsAddr + "/health/ready")
		if err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode == 200 {
				ready = true
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		t.Fatal("startup not ready")
	}
	resp, err := client.Get("http://" + cfg.APIAddr + "/api/wallet")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown hung")
	}
	// Listener failures must close earlier listeners and DB handles.
	for _, ops := range []bool{false, true} {
		occupied, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		cfg.APIAddr = freeAddress(t)
		cfg.OpsAddr = ""
		if ops {
			cfg.OpsAddr = occupied.Addr().String()
		} else {
			cfg.APIAddr = occupied.Addr().String()
		}
		if err := Run(context.Background(), cfg, logger); err == nil {
			t.Fatal("occupied listener accepted")
		}
		occupied.Close()
		if ops {
			listener, err := net.Listen("tcp", cfg.APIAddr)
			if err != nil {
				t.Fatal("API listener leaked", err)
			}
			listener.Close()
		}
	}
	cfg.DBPath = t.TempDir()
	if err := Run(context.Background(), cfg, logger); err == nil {
		t.Fatal("invalid DB startup accepted")
	}
}

func TestFailureLoggingUTCAndPrivateCauses(t *testing.T) {
	for _, cause := range []error{
		errors.New("PRIVATE_SQL_OR_CONFIGURATION"),
		syscall.EADDRINUSE, syscall.EACCES, context.DeadlineExceeded,
		&application.StorageError{Kind: "corrupt", Operation: "outcome_get", Stage: "decode", DriverCode: 11, Err: errors.New("PRIVATE_DB_PATH")},
	} {
		var output bytes.Buffer
		logger := NewLogger(&output, slog.LevelInfo)
		err := failed("storage_open", cause)
		if !errors.Is(err, cause) || err.Error() == "" {
			t.Fatal("lost cause")
		}
		LogFailure(logger, err)
		var record map[string]any
		if json.Unmarshal(output.Bytes(), &record) != nil {
			t.Fatal(output.String())
		}
		if record["stage"] != "storage_open" || strings.Contains(output.String(), "PRIVATE") || !strings.HasSuffix(record["time"].(string), "Z") {
			t.Fatal(record)
		}
	}
	if failed("runtime", nil) != nil {
		t.Fatal("nil failure")
	}
	var output bytes.Buffer
	LogFailure(NewLogger(&output, nil), errors.New("PRIVATE_UNKNOWN"))
	if strings.Contains(output.String(), "PRIVATE_UNKNOWN") {
		t.Fatal("raw error logged")
	}
}
