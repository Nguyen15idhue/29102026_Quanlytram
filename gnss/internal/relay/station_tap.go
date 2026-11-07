package relay

import (
	"errors"
	"io"
	"sync"
)

// errStationSourceOffline báo trạm chưa có phiên station source đang chạy để
// relay chọn trạm nguồn đọc trực tiếp.
var errStationSourceOffline = errors.New("station_source_offline")

// stationSourceTap là subscriber in-process của một trạm. Relay "Chọn trạm"
// đọc thẳng byte của phiên station source theo stationID, không mở kết nối
// NTRIP client tới hệ thống ngoài.
type stationSourceTap struct {
	id      int64
	ch      chan []byte
	closed  chan struct{}
	once    sync.Once
	pending []byte
}

func newStationSourceTap(id int64) *stationSourceTap {
	return &stationSourceTap{
		id:     id,
		ch:     make(chan []byte, 256),
		closed: make(chan struct{}),
	}
}

func (t *stationSourceTap) trySend(data []byte) bool {
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

func (t *stationSourceTap) close() {
	t.once.Do(func() {
		close(t.closed)
	})
}

func (t *stationSourceTap) Read(p []byte) (int, error) {
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

// stationSourceTapReader tự gỡ tap khỏi manager khi relay đóng luồng.
type stationSourceTapReader struct {
	mgr       *StationSourceManager
	stationID int64
	tap       *stationSourceTap
}

func (r *stationSourceTapReader) Read(p []byte) (int, error) {
	return r.tap.Read(p)
}

func (r *stationSourceTapReader) Close() error {
	r.mgr.removeTap(r.stationID, r.tap)
	return nil
}
