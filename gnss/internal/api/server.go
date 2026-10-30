package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"cors/gnss/internal/db"
)

type Server struct {
	db      *sql.DB
	adminDB string
}

func New(database *sql.DB, adminDB string) *Server {
	return &Server{db: database, adminDB: adminDB}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
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
	httpStatus := http.StatusOK
	version := 0
	if err := s.db.PingContext(ctx); err != nil {
		status = "error"
		httpStatus = http.StatusServiceUnavailable
	} else {
		v, err := db.SchemaVersion(ctx, s.db, s.adminDB)
		if err != nil || v < 1 {
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
		"db":            status,
		"schemaVersion": version,
		"time":          time.Now().UTC().Format(time.RFC3339),
	})
}
