package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"cors/gnss/internal/db"
	"cors/gnss/internal/relay"
)

type RelayManager interface {
	Reconcile(ctx context.Context, ids []int64) error
	Test(ctx context.Context, id int64) relay.TestResult
	Snapshot() []relay.MetricsSnapshot
}

type Server struct {
	db         *sql.DB
	adminDB    string
	manager    RelayManager
	hmacSecret string

	nonceMu sync.Mutex
	nonces  map[string]time.Time
}

func New(database *sql.DB, adminDB string, manager RelayManager, hmacSecret string) *Server {
	return &Server{
		db:         database,
		adminDB:    adminDB,
		manager:    manager,
		hmacSecret: hmacSecret,
		nonces:     make(map[string]time.Time),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/internal/reconcile", s.requireSignature(s.handleReconcile, http.MethodPost))
	mux.HandleFunc("/internal/test", s.requireSignature(s.handleTest, http.MethodPost))
	mux.HandleFunc("/internal/snapshot", s.requireSignature(s.handleSnapshot, http.MethodGet))
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	status := "ok"
	dbStatus := "ok"
	httpStatus := http.StatusOK
	version := 0
	if err := s.db.PingContext(ctx); err != nil {
		status = "error"
		dbStatus = "error"
		httpStatus = http.StatusServiceUnavailable
	} else {
		v, err := db.SchemaVersion(ctx, s.db, s.adminDB)
		if err != nil || v < 2 {
			status = "degraded"
			httpStatus = http.StatusServiceUnavailable
		} else {
			version = v
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":        status,
		"db":            dbStatus,
		"schemaVersion": version,
		"time":          time.Now().UTC().Format(time.RFC3339),
	})
}

type signedHandler func(http.ResponseWriter, *http.Request, []byte)

func (s *Server) requireSignature(next signedHandler, method string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, "cannot read body")
			return
		}
		if err := s.verifySignature(r, body); err != nil {
			writeError(w, http.StatusUnauthorized, "invalid signature")
			return
		}
		next(w, r, body)
	}
}

func (s *Server) verifySignature(r *http.Request, body []byte) error {
	if s.hmacSecret == "" {
		return errors.New("internal HMAC secret is not configured")
	}
	timestamp := r.Header.Get("X-Timestamp")
	nonce := r.Header.Get("X-Nonce")
	bodyHash := r.Header.Get("X-Body-SHA256")
	signature := r.Header.Get("X-Signature")
	if timestamp == "" || nonce == "" || bodyHash == "" || signature == "" {
		return errors.New("missing signature headers")
	}

	unixMillis, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return errors.New("invalid timestamp")
	}
	now := time.Now().UnixMilli()
	if unixMillis < now-60_000 || unixMillis > now+60_000 {
		return errors.New("timestamp outside window")
	}

	computedHash := sha256.Sum256(body)
	computedHex := hex.EncodeToString(computedHash[:])
	if !hmac.Equal([]byte(computedHex), []byte(bodyHash)) {
		return errors.New("body hash mismatch")
	}

	payload := strings.Join([]string{
		r.Method,
		r.URL.Path,
		timestamp,
		nonce,
		bodyHash,
	}, "\n")
	mac := hmac.New(sha256.New, []byte(s.hmacSecret))
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return errors.New("signature mismatch")
	}

	s.nonceMu.Lock()
	defer s.nonceMu.Unlock()
	if expiresAt, exists := s.nonces[nonce]; exists && expiresAt.After(time.Now()) {
		return errors.New("nonce replay")
	}
	if len(s.nonces) > 10000 {
		for key, expiresAt := range s.nonces {
			if expiresAt.Before(time.Now()) {
				delete(s.nonces, key)
			}
		}
	}
	s.nonces[nonce] = time.Now().Add(2 * time.Minute)
	return nil
}

func (s *Server) handleReconcile(w http.ResponseWriter, r *http.Request, body []byte) {
	var request struct {
		JobIDs []int64 `json:"jobIds"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
	}
	if err := s.manager.Reconcile(r.Context(), request.JobIDs); err != nil {
		writeError(w, http.StatusInternalServerError, "reconcile failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleTest(w http.ResponseWriter, r *http.Request, body []byte) {
	var request struct {
		JobID int64 `json:"jobId"`
	}
	if err := json.Unmarshal(body, &request); err != nil || request.JobID <= 0 {
		writeError(w, http.StatusBadRequest, "jobId is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.manager.Test(ctx, request.JobID))
}

func (s *Server) handleSnapshot(w http.ResponseWriter, _ *http.Request, _ []byte) {
	writeJSON(w, http.StatusOK, map[string]any{
		"items": s.manager.Snapshot(),
		"time":  time.Now().UTC().Format(time.RFC3339),
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": "INTERNAL_API", "message": message}})
}
