//! Game levels. The level file is authoritative: the player only chooses the
//! topology, instance counts and edge policies. Performance and price of each
//! component come from the catalog, so a submitted design cannot cheat by
//! editing `costPerHour` or `concurrency`. Running this in the browser and on
//! the server gives the same score (see `crate::sim` determinism notes).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::model::{Design, EdgeSpec, NodeConfig, NodeKind, NodeSpec, Scenario, SimInput};
use crate::sim::{Simulation, Summary};

pub const MAX_NODES: usize = 40;
pub const MAX_EDGES: usize = 80;
pub const MAX_RETRIES: u32 = 5;

/// Per-instance performance and price of each buildable component.
pub fn default_catalog(kind: NodeKind) -> NodeConfig {
    let c = |concurrency, queue_size, p50, p99, cost| NodeConfig {
        instances: 1,
        concurrency,
        queue_size,
        latency_p50_ms: p50,
        latency_p99_ms: p99,
        error_rate: 0.0,
        hit_rate: 0.0,
        cost_per_hour: cost,
        ..NodeConfig::default()
    };
    match kind {
        NodeKind::Client => c(1, 0, 0.0, 0.0, 0.0),
        NodeKind::LoadBalancer => c(20_000, 0, 0.2, 1.0, 0.03),
        NodeKind::Service => c(80, 50, 15.0, 50.0, 0.10),
        NodeKind::Cache => NodeConfig {
            hit_rate: 0.9,
            ..c(2_000, 1_000, 0.5, 2.0, 0.15)
        },
        NodeKind::Database => c(20, 200, 8.0, 40.0, 0.50),
        NodeKind::Queue => c(36, 500_000, 0.2, 1.0, 0.08),
    }
}

fn default_max_instances() -> u32 {
    10
}
fn default_edge_latency() -> f64 {
    1.0
}
fn default_client_latency() -> f64 {
    5.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    pub id: String,
    /// Components the player may add.
    pub palette: Vec<NodeKind>,
    #[serde(default = "default_max_instances")]
    pub max_instances: u32,
    /// Starting design. Nodes listed in `locked` keep their kind and config
    /// from here and cannot be removed.
    pub design: Design,
    #[serde(default)]
    pub locked: Vec<String>,
    /// Per-level overrides of [`default_catalog`].
    #[serde(default)]
    pub catalog: HashMap<NodeKind, NodeConfig>,
    #[serde(default = "default_edge_latency")]
    pub edge_latency_ms: f64,
    #[serde(default = "default_client_latency")]
    pub client_latency_ms: f64,
    /// Whether players may mark calls fire-and-forget (otherwise a read
    /// could "skip" waiting for its data).
    #[serde(default)]
    pub allow_fire_and_forget: bool,
    /// `[source, target]` calls the design must keep (the business logic:
    /// a product page needs its prices), so a level about call order cannot
    /// be won by deleting calls.
    #[serde(default)]
    pub required_edges: Vec<(String, String)>,
    pub scenario: Scenario,
}

impl Level {
    pub fn catalog_for(&self, kind: NodeKind) -> NodeConfig {
        self.catalog
            .get(&kind)
            .cloned()
            .unwrap_or_else(|| default_catalog(kind))
    }

    /// Turn a player design into a simulation input, enforcing the rules.
    pub fn build_input(&self, player: &Design) -> Result<SimInput, String> {
        if player.nodes.len() > MAX_NODES {
            return Err(format!("too many nodes (max {MAX_NODES})"));
        }
        if player.edges.len() > MAX_EDGES {
            return Err(format!("too many edges (max {MAX_EDGES})"));
        }
        let locked: HashMap<&str, &NodeSpec> = self
            .design
            .nodes
            .iter()
            .filter(|n| self.locked.contains(&n.id))
            .map(|n| (n.id.as_str(), n))
            .collect();
        let mut seen = HashSet::new();
        let mut nodes = Vec::with_capacity(player.nodes.len());
        for n in &player.nodes {
            if !seen.insert(n.id.as_str()) {
                return Err(format!("duplicate node id '{}'", n.id));
            }
            if let Some(fixed) = locked.get(n.id.as_str()) {
                nodes.push((*fixed).clone());
                continue;
            }
            if n.kind == NodeKind::Client {
                return Err("the client is provided by the level".into());
            }
            // nodes of the starting design may stay even if their kind is
            // not in the palette (the player tunes them, cannot add more)
            let from_level = self
                .design
                .nodes
                .iter()
                .any(|d| d.id == n.id && d.kind == n.kind);
            if !self.palette.contains(&n.kind) && !from_level {
                return Err(format!("'{:?}' is not available in this level", n.kind));
            }
            let mut config = self.catalog_for(n.kind);
            config.instances = n.config.instances.clamp(1, self.max_instances.max(1));
            config.routing = n.config.routing;
            nodes.push(NodeSpec {
                id: n.id.clone(),
                kind: n.kind,
                config,
            });
        }
        if let Some(missing) = self.locked.iter().find(|id| !seen.contains(id.as_str())) {
            return Err(format!("locked node '{missing}' was removed"));
        }

        let kinds: HashMap<&str, NodeKind> =
            nodes.iter().map(|n| (n.id.as_str(), n.kind)).collect();
        let edges: Vec<EdgeSpec> = player
            .edges
            .iter()
            .map(|e| {
                let from_client = kinds.get(e.source.as_str()) == Some(&NodeKind::Client);
                EdgeSpec {
                    latency_ms: if from_client {
                        self.client_latency_ms
                    } else {
                        self.edge_latency_ms
                    },
                    timeout_ms: e.timeout_ms.map(|t| t.max(1.0)),
                    retries: e.retries.min(MAX_RETRIES),
                    backoff_ms: e.backoff_ms.clamp(0.0, 10_000.0),
                    pool_size: None,
                    fire_and_forget: e.fire_and_forget && self.allow_fire_and_forget,
                    hedge_after_ms: None,
                    request_kb: 0.0,
                    response_kb: 0.0,
                    bandwidth_mbps: 1000.0,
                    ..e.clone()
                }
            })
            .collect();

        if let Some((s, t)) = self
            .required_edges
            .iter()
            .find(|(s, t)| !edges.iter().any(|e| &e.source == s && &e.target == t))
        {
            return Err(format!("the call {s} -> {t} is required by this level"));
        }

        let mut scenario = self.scenario.clone();
        if scenario.duration_ms.is_none() {
            return Err("level scenario needs durationMs".into());
        }
        scenario.window_ms = scenario.window_ms.max(1000.0);
        Ok(SimInput {
            design: Design { nodes, edges },
            scenario,
        })
    }

    pub fn play(&self, player: &Design) -> Result<Summary, String> {
        let input = self.build_input(player)?;
        let mut sim = Simulation::new(&input, false)?;
        sim.run_to_end()?;
        Ok(sim.summary())
    }
}

/// Parse a level and a player design (JSON), run it and return the summary.
pub fn play_level(level_json: &str, design_json: &str) -> Result<Summary, String> {
    let level: Level = serde_json::from_str(level_json).map_err(|e| format!("level: {e}"))?;
    let design: Design = serde_json::from_str(design_json).map_err(|e| format!("design: {e}"))?;
    level.play(&design)
}

/// Same as [`play_level`] but returns the sanitized input instead, so the UI
/// can preview a design live with the exact numbers the score will use.
pub fn level_input(level_json: &str, design_json: &str) -> Result<SimInput, String> {
    let level: Level = serde_json::from_str(level_json).map_err(|e| format!("level: {e}"))?;
    let design: Design = serde_json::from_str(design_json).map_err(|e| format!("design: {e}"))?;
    level.build_input(&design)
}
