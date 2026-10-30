package relay

import (
	"math/rand"
	"sync"
	"time"
)

type Backoff struct {
	mu      sync.Mutex
	min     time.Duration
	max     time.Duration
	current time.Duration
	random  *rand.Rand
}

func NewBackoff(minimum, maximum time.Duration) *Backoff {
	if minimum <= 0 {
		minimum = time.Second
	}
	if maximum < minimum {
		maximum = minimum
	}
	return &Backoff{
		min:     minimum,
		max:     maximum,
		current: minimum,
		random:  rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (b *Backoff) Next() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()

	base := b.current
	if base > b.max {
		base = b.max
	}
	jitter := 0.8 + b.random.Float64()*0.4
	wait := time.Duration(float64(base) * jitter)

	b.current *= 2
	if b.current > b.max {
		b.current = b.max
	}
	return wait
}

func (b *Backoff) Reset() {
	b.mu.Lock()
	b.current = b.min
	b.mu.Unlock()
}
