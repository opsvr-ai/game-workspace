package engine

import (
	"sync"
	"time"
)

type Mode string

const (
	ModeWork          Mode = "WORK"
	ModeEntertainment Mode = "ENTERTAINMENT"
)

type TimeTracker struct {
	mu               sync.RWMutex
	CurrentMode      Mode
	ModeStartedAt    time.Time
	WorkSeconds      int64
	EntertainSeconds int64
}

func NewTimeTracker() *TimeTracker {
	return &TimeTracker{
		CurrentMode:   ModeEntertainment,
		ModeStartedAt: time.Now(),
	}
}

func (t *TimeTracker) SwitchMode(mode Mode) {
	t.mu.Lock()
	defer t.mu.Unlock()

	elapsed := int64(time.Since(t.ModeStartedAt).Seconds())
	if t.CurrentMode == ModeWork {
		t.WorkSeconds += elapsed
	} else {
		t.EntertainSeconds += elapsed
	}
	t.CurrentMode = mode
	t.ModeStartedAt = time.Now()
}

func (t *TimeTracker) GetSnapshot() (mode Mode, workSec int64, entertainSec int64, totalSec int64) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	elapsed := int64(time.Since(t.ModeStartedAt).Seconds())
	w, e := t.WorkSeconds, t.EntertainSeconds
	if t.CurrentMode == ModeWork {
		w += elapsed
	} else {
		e += elapsed
	}
	return t.CurrentMode, w, e, w + e
}
