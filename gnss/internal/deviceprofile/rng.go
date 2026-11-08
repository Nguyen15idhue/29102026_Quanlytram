package deviceprofile

// rngFallbackSeed tránh trạng thái 0 của xorshift (0 ^ 0 = 0 nên không tiến).
const rngFallbackSeed uint64 = 0x9E3779B97F4A7C15

// RNG là bộ sinh số giả ngẫu nhiên tất định (xorshift64) để Go và Node cho ra
// cùng một version UA với cùng seed. Không dùng math/rand vì thuật toán của nó
// khó port chính xác sang JavaScript.
type RNG struct {
	state uint64
}

// NewRNG tạo bộ sinh với seed; seed 0 được thay bằng hằng số cố định.
func NewRNG(seed uint64) *RNG {
	if seed == 0 {
		seed = rngFallbackSeed
	}
	return &RNG{state: seed}
}

// Uint64 trả số kế tiếp.
func (r *RNG) Uint64() uint64 {
	x := r.state
	x ^= x << 13
	x ^= x >> 7
	x ^= x << 17
	r.state = x
	return x
}

// Intn trả số nguyên trong [0, n). n <= 0 trả 0.
func (r *RNG) Intn(n int) int {
	if n <= 0 {
		return 0
	}
	return int(r.Uint64() % uint64(n))
}

// Float64 trả số thực trong [0, 1).
func (r *RNG) Float64() float64 {
	return float64(r.Uint64()>>11) / float64(uint64(1)<<53)
}
