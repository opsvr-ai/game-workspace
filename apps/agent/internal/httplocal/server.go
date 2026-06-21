package httplocal

import (
	"encoding/json"
	"net/http"

	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/wsclient"
	"github.com/gorilla/mux"
)

type Server struct {
	tracker  *engine.TimeTracker
	wsClient *wsclient.Client
}

func StartServer(addr string, tracker *engine.TimeTracker, wsClient *wsclient.Client) {
	s := &Server{tracker: tracker, wsClient: wsClient}
	r := mux.NewRouter()

	r.HandleFunc("/api/status", s.handleStatus).Methods("GET")
	r.HandleFunc("/api/mode", s.handleModeSwitch).Methods("POST")
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./webui")))

	http.ListenAndServe(addr, r)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	mode, workSec, entertainSec, totalSec := s.tracker.GetSnapshot()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mode":          mode,
		"workSec":       workSec,
		"entertainSec":  entertainSec,
		"totalSec":      totalSec,
	})
}

func (s *Server) handleModeSwitch(w http.ResponseWriter, r *http.Request) {
	var req struct{ Mode string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	mode := engine.ModeWork
	status := "ONLINE"
	if req.Mode == "ENTERTAINMENT" {
		mode = engine.ModeEntertainment
		status = "IDLE"
	}

	s.tracker.SwitchMode(mode)
	s.wsClient.SendStatus(status, mode)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}
