package caster

import (
	"bufio"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

type connection struct {
	id              int64
	direction       string
	listenerID      int64
	mountpointID    int64
	accountID       *int64
	accountUsername string
	remoteAddr      string
	userAgent       string
	start           time.Time

	conn net.Conn
	br   *bufio.Reader
	hub  *hub
	mgr  *manager

	sendCh    chan []byte
	done      chan struct{}
	closeOnce sync.Once
	reasonMu  sync.Mutex
	reason    string

	bytesIn  atomic.Uint64
	bytesOut atomic.Uint64
	closed   atomic.Bool
}

func (c *connection) snapshot() ConnectionSnapshot {
	return ConnectionSnapshot{
		ID:           c.id,
		Direction:    c.direction,
		ListenerID:   c.listenerID,
		MountpointID: c.mountpointID,
		AccountID:    c.accountID,
		RemoteAddr:   c.remoteAddr,
		UserAgent:    c.userAgent,
		StartTs:      c.start.UTC().Format(time.RFC3339Nano),
		BytesIn:      c.bytesIn.Load(),
		BytesOut:     c.bytesOut.Load(),
	}
}

func (c *connection) closeWithReason(reason string) {
	c.closeOnce.Do(func() {
		c.closed.Store(true)
		c.reasonMu.Lock()
		c.reason = reason
		c.reasonMu.Unlock()

		_ = c.conn.Close()
		close(c.done)
		if c.mgr != nil {
			c.mgr.connectionClosed(c, reason)
		}
	})
}

func (c *connection) isClosed() bool {
	return c.closed.Load()
}

func (c *connection) closeReason() string {
	c.reasonMu.Lock()
	defer c.reasonMu.Unlock()
	return c.reason
}

func (c *connection) enqueue(data []byte) bool {
	select {
	case c.sendCh <- data:
		return true
	default:
		return false
	}
}

func (c *connection) roverWriteLoop(writeTimeout time.Duration) {
	for {
		select {
		case <-c.done:
			return
		case data := <-c.sendCh:
			if writeTimeout > 0 {
				_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			}
			written, err := c.conn.Write(data)
			c.bytesOut.Add(uint64(written))
			if err != nil {
				c.closeWithReason("slow_client")
				return
			}
		}
	}
}

func (c *connection) roverReadLoop() {
	_, err := io.Copy(io.Discard, c.br)
	reason := "client_closed"
	if err != nil && !errors.Is(err, io.EOF) {
		reason = "network"
	}
	c.closeWithReason(reason)
}

func (c *connection) sourceReadLoop(reader io.Reader, readBuffer int) {
	if readBuffer <= 0 {
		readBuffer = 32 * 1024
	}
	buffer := make([]byte, readBuffer)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			c.bytesIn.Add(uint64(n))
			c.hub.publish(buffer[:n])
		}
		if err != nil {
			reason := "source_closed"
			if !errors.Is(err, io.EOF) {
				reason = "network"
			}
			c.closeWithReason(reason)
			return
		}
	}
}
