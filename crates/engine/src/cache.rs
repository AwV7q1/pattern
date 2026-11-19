//! Key-level cache state for `cache` nodes with a [`CacheModel`]: Zipf key
//! popularity, TTL, LRU eviction and the bookkeeping for singleflight and
//! stale-while-revalidate. Everything lives in flat vectors indexed by key so
//! runs stay deterministic and allocation free in the hot path.

use std::collections::HashMap;

use crate::model::CacheModel;

pub type Time = u64;

const NIL: u32 = u32::MAX;
/// Upper bound on distinct keys (memory: ~25 bytes per key).
pub const MAX_KEYS: u32 = 1_000_000;

/// What a lookup found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lookup {
    /// Fresh entry.
    Hit,
    /// Expired entry served anyway (`staleWhileRevalidate`).
    Stale,
    Miss,
}

pub struct CacheRt {
    pub cfg: CacheModel,
    ttl: Time,
    /// Cumulative popularity, `cdf[k]` = P(key <= k).
    cdf: Vec<f64>,
    /// Expiry per key; 0 = not cached.
    expires: Vec<Time>,
    prev: Vec<u32>,
    next: Vec<u32>,
    head: u32,
    tail: u32,
    size: u32,
    /// Keys with a fill in flight (singleflight leader or background
    /// refresh) → calls `(id, gen)` waiting for it.
    pub inflight: HashMap<u32, Vec<(u32, u32)>>,
    pub w_lookups: u64,
    pub w_hits: u64,
}

impl CacheRt {
    pub fn new(cfg: CacheModel) -> Self {
        let keys = cfg.keys.clamp(1, MAX_KEYS);
        let s = cfg.zipf.max(0.0);
        let mut cdf = Vec::with_capacity(keys as usize);
        let mut sum = 0.0;
        for k in 0..keys {
            sum += 1.0 / libm::pow(k as f64 + 1.0, s);
            cdf.push(sum);
        }
        for v in &mut cdf {
            *v /= sum;
        }
        let ttl = if cfg.ttl_ms > 0.0 {
            (cfg.ttl_ms * 1000.0).round() as Time
        } else {
            Time::MAX
        };
        let mut c = Self {
            cfg: CacheModel { keys, ..cfg },
            ttl,
            cdf,
            expires: vec![0; keys as usize],
            prev: vec![NIL; keys as usize],
            next: vec![NIL; keys as usize],
            head: NIL,
            tail: NIL,
            size: 0,
            inflight: HashMap::new(),
            w_lookups: 0,
            w_hits: 0,
        };
        if cfg.warm {
            // most popular keys, expiries spread evenly over one TTL so the
            // cache does not expire all at once
            let n = c.capacity().min(keys);
            for k in (0..n).rev() {
                let exp = if ttl == Time::MAX {
                    Time::MAX
                } else {
                    1 + ttl / n as u64 * (k as u64 + 1)
                };
                c.insert(k, exp);
            }
        }
        c
    }

    fn capacity(&self) -> u32 {
        self.cfg.capacity.max(1)
    }

    /// Key for a uniform random number `u` in [0, 1).
    pub fn key_for(&self, u: f64) -> u32 {
        let i = self.cdf.partition_point(|&p| p <= u);
        (i as u32).min(self.cfg.keys - 1)
    }

    pub fn lookup(&mut self, key: u32, now: Time) -> Lookup {
        self.w_lookups += 1;
        let exp = self.expires[key as usize];
        if exp == 0 {
            return Lookup::Miss;
        }
        if exp > now {
            self.touch(key);
            self.w_hits += 1;
            return Lookup::Hit;
        }
        if self.cfg.stale_while_revalidate {
            self.touch(key);
            self.w_hits += 1;
            return Lookup::Stale;
        }
        Lookup::Miss
    }

    /// Store `key` after a successful fill at `now`.
    pub fn fill(&mut self, key: u32, now: Time) {
        let exp = now.saturating_add(self.ttl).max(1);
        self.insert(key, exp);
    }

    fn insert(&mut self, key: u32, exp: Time) {
        if self.expires[key as usize] != 0 {
            self.expires[key as usize] = exp;
            self.touch(key);
            return;
        }
        if self.size >= self.capacity() {
            let victim = self.tail;
            if victim != NIL {
                self.unlink(victim);
                self.expires[victim as usize] = 0;
                self.size -= 1;
            }
        }
        self.expires[key as usize] = exp;
        self.push_front(key);
        self.size += 1;
    }

    /// Drop every entry (in-flight fills still land afterwards).
    pub fn flush(&mut self) {
        let mut k = self.head;
        while k != NIL {
            let n = self.next[k as usize];
            self.expires[k as usize] = 0;
            self.prev[k as usize] = NIL;
            self.next[k as usize] = NIL;
            k = n;
        }
        self.head = NIL;
        self.tail = NIL;
        self.size = 0;
    }

    pub fn len(&self) -> u32 {
        self.size
    }

    fn touch(&mut self, key: u32) {
        if self.head == key {
            return;
        }
        self.unlink(key);
        self.push_front(key);
    }

    fn unlink(&mut self, key: u32) {
        let (p, n) = (self.prev[key as usize], self.next[key as usize]);
        if p != NIL {
            self.next[p as usize] = n;
        } else if self.head == key {
            self.head = n;
        }
        if n != NIL {
            self.prev[n as usize] = p;
        } else if self.tail == key {
            self.tail = p;
        }
        self.prev[key as usize] = NIL;
        self.next[key as usize] = NIL;
    }

    fn push_front(&mut self, key: u32) {
        self.prev[key as usize] = NIL;
        self.next[key as usize] = self.head;
        if self.head != NIL {
            self.prev[self.head as usize] = key;
        }
        self.head = key;
        if self.tail == NIL {
            self.tail = key;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache(capacity: u32, ttl_ms: f64) -> CacheRt {
        CacheRt::new(CacheModel {
            keys: 100,
            zipf: 1.0,
            capacity,
            ttl_ms,
            ..CacheModel::default()
        })
    }

    #[test]
    fn zipf_prefers_low_keys() {
        let c = cache(10, 0.0);
        assert_eq!(c.key_for(0.0), 0);
        assert_eq!(c.key_for(0.999_999), 99);
        // key 0 alone holds ~19% of the mass for s=1, n=100
        assert_eq!(c.key_for(0.15), 0);
        assert!(c.key_for(0.5) < 10);
    }

    #[test]
    fn lru_evicts_least_recent_and_ttl_expires() {
        let mut c = cache(2, 1.0); // 1 ms
        c.fill(1, 0);
        c.fill(2, 0);
        assert_eq!(c.lookup(1, 10), Lookup::Hit); // 1 is now most recent
        c.fill(3, 10); // evicts 2
        assert_eq!(c.lookup(2, 10), Lookup::Miss);
        assert_eq!(c.lookup(1, 10), Lookup::Hit);
        assert_eq!(c.lookup(1, 2_000), Lookup::Miss); // expired
        assert_eq!(c.len(), 2);
        c.flush();
        assert_eq!(c.len(), 0);
        assert_eq!(c.lookup(3, 10), Lookup::Miss);
    }

    #[test]
    fn warm_start_and_stale_while_revalidate() {
        let mut c = CacheRt::new(CacheModel {
            keys: 100,
            capacity: 10,
            ttl_ms: 10.0,
            warm: true,
            stale_while_revalidate: true,
            ..CacheModel::default()
        });
        assert_eq!(c.len(), 10);
        assert_eq!(c.lookup(9, 0), Lookup::Hit);
        assert_eq!(c.lookup(10, 0), Lookup::Miss);
        assert_eq!(c.lookup(0, 1_000_000), Lookup::Stale);
    }
}
