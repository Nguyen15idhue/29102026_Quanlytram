package caster

import (
	"errors"
	"io"
	"sync"
)

// errNoSource báo mountpoint chưa có source để relay đọc trực tiếp.
var errNoSource = errors.New("mountpoint has no source")

// stationTap là subscriber in-process cho relay chọn trạm nguồn nội bộ.
// Relay đọc thẳng byte source đang publish vào caster, không qua NTRIP account.
type stationTap struct {
	id      int64
	ch      chan []byte
	closed  chan struct{}
	once    sync.Once
	pending []byte
}

func newStationTap(id int64) *stationTap {
	return &stationTap{
		id:     id,
		ch:     make(chan []byte, 256),
		closed: make(chan struct{}),
	}
}

func (t *stationTap) trySend(data []byte) bool {
	select {
	case <-t.closed:
		return false
	default:
	}
	select {
	case t.ch <- data:
		return true
	default:
		return false
	}
}

func (t *stationTap) close() {
	t.once.Do(func() {
		close(t.closed)
	})
}

func (t *stationTap) Read(p []byte) (int, error) {
	for len(t.pending) == 0 {
		select {
		case data := <-t.ch:
			t.pending = data
		case <-t.closed:
			return 0, io.EOF
		}
	}
	n := copy(p, t.pending)
	t.pending = t.pending[n:]
	return n, nil
}
