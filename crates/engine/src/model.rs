//! Input model shared with the UI (JSON, camelCase). Unknown fields such as
//! node `position` or `label` used only by the UI are ignored by serde.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    /// Traffic source. Exactly one per design.
    Client,
    /// Spreads requests round-robin over its outgoing edges.
    LoadBalancer,
    /// Processes a request, then calls one downstream (round-robin) if any.
    Service,
    /// Answers hits locally; forwards misses downstream.
    Cache,
    /// Usually a leaf; behaves like a service.
    Database,
    /// Fire-and-forget buffer: acknowledges immediately, delivers async.
    Queue,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct NodeConfig {
    pub instances: u32,
    /// Concurrent requests per instance.
    pub concurrency: u32,
    /// Waiting requests per instance before rejecting.
    pub queue_size: u32,
    pub latency_p50_ms: f64,
    pub latency_p99_ms: f64,
    /// Probability that a processed request fails (0..1).
    pub error_rate: f64,
    /// Cache hit ratio (0..1), only used by `cache` nodes.
    pub hit_rate: f64,
    /// Cost per instance per hour (any currency unit).
    pub cost_per_hour: f64,
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            instances: 1,
            concurrency: 100,
            queue_size: 100,
            latency_p50_ms: 1.0,
            latency_p99_ms: 5.0,
            error_rate: 0.0,
            hit_rate: 0.0,
            cost_per_hour: 0.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeSpec {
    pub id: String,
    pub kind: NodeKind,
    #[serde(default)]
    pub config: NodeConfig,
}

fn default_edge_latency() -> f64 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EdgeSpec {
    pub source: String,
    pub target: String,
    /// One-way network latency in ms.
    #[serde(default = "default_edge_latency")]
    pub latency_ms: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Design {
    pub nodes: Vec<NodeSpec>,
    pub edges: Vec<EdgeSpec>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrafficPhase {
    pub at_ms: f64,
    pub rps: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slo {
    pub p99_ms: f64,
    pub error_rate: f64,
}

impl Default for Slo {
    fn default() -> Self {
        Self {
            p99_ms: 200.0,
            error_rate: 0.01,
        }
    }
}

fn default_timeout() -> f64 {
    2000.0
}
fn default_window() -> f64 {
    1000.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    #[serde(default)]
    pub seed: u64,
    /// Required for headless runs; interactive runs ignore it.
    #[serde(default)]
    pub duration_ms: Option<f64>,
    /// Client-side timeout: slower requests count as errors.
    #[serde(default = "default_timeout")]
    pub timeout_ms: f64,
    /// Step function of request rate over time.
    pub traffic: Vec<TrafficPhase>,
    #[serde(default)]
    pub slo: Slo,
    #[serde(default = "default_window")]
    pub window_ms: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimInput {
    pub design: Design,
    pub scenario: Scenario,
}
