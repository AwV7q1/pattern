//! Small, fast, seedable RNG (SplitMix64). Deterministic across platforms.

use std::f64::consts::PI;

#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut r = Rng(seed ^ 0x9E37_79B9_7F4A_7C15);
        r.next_u64();
        r
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Exponentially distributed value with the given rate (mean = 1 / rate).
    pub fn exp(&mut self, rate: f64) -> f64 {
        -libm::log(1.0 - self.f64()) / rate
    }

    /// Standard normal via Box-Muller.
    pub fn normal(&mut self) -> f64 {
        let u1 = 1.0 - self.f64(); // (0, 1]
        let u2 = self.f64();
        (-2.0 * libm::log(u1)).sqrt() * libm::cos(2.0 * PI * u2)
    }

    pub fn lognormal(&mut self, mu: f64, sigma: f64) -> f64 {
        libm::exp(mu + sigma * self.normal())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn exp_mean_is_close() {
        let mut r = Rng::new(7);
        let n = 200_000;
        let mean: f64 = (0..n).map(|_| r.exp(4.0)).sum::<f64>() / n as f64;
        assert!((mean - 0.25).abs() < 0.005, "mean = {mean}");
    }
}
