//! Log-bucketed latency histogram (~1% relative precision, bounded memory).

const GROWTH: f64 = 1.02;
const BUCKETS: usize = 1200; // covers up to ~2.0e10 µs

#[derive(Clone, Debug)]
pub struct Histogram {
    buckets: Vec<u64>,
    count: u64,
}

impl Default for Histogram {
    fn default() -> Self {
        Self {
            buckets: vec![0; BUCKETS],
            count: 0,
        }
    }
}

impl Histogram {
    fn index(v: u64) -> usize {
        if v < 1 {
            0
        } else {
            ((libm::log(v as f64) / libm::log(GROWTH)) as usize + 1).min(BUCKETS - 1)
        }
    }

    fn value(i: usize) -> f64 {
        if i == 0 {
            0.0
        } else {
            // geometric midpoint of the bucket
            libm::exp((i as f64 - 0.5) * libm::log(GROWTH))
        }
    }

    pub fn record(&mut self, v: u64) {
        self.buckets[Self::index(v)] += 1;
        self.count += 1;
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    /// Percentile in the recorded unit; `p` in [0, 1]. Returns 0 when empty.
    pub fn percentile(&self, p: f64) -> f64 {
        if self.count == 0 {
            return 0.0;
        }
        let target = ((p * self.count as f64).ceil() as u64).clamp(1, self.count);
        let mut acc = 0;
        for (i, &c) in self.buckets.iter().enumerate() {
            acc += c;
            if acc >= target {
                return Self::value(i);
            }
        }
        Self::value(BUCKETS - 1)
    }

    pub fn clear(&mut self) {
        self.buckets.iter_mut().for_each(|b| *b = 0);
        self.count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_are_within_precision() {
        let mut h = Histogram::default();
        for v in 1..=10_000u64 {
            h.record(v);
        }
        let p50 = h.percentile(0.5);
        let p99 = h.percentile(0.99);
        assert!((p50 - 5000.0).abs() / 5000.0 < 0.02, "p50 = {p50}");
        assert!((p99 - 9900.0).abs() / 9900.0 < 0.02, "p99 = {p99}");
    }
}
