//! Server sizing: from a target load and a few measured per-request costs to
//! a concrete VPS/server choice, verified by simulation.
//!
//! 1. Analytic estimate (utilization law): cores and connections needed.
//! 2. Candidates (plan × count × DB plan) that fit RAM and are not
//!    obviously overloaded, cheapest first.
//! 3. Each candidate is simulated as a Node.js cluster + Postgres design
//!    under peak, burst and "one server lost"; the cheapest that meets the
//!    SLO in all of them is recommended.

use serde::{Deserialize, Serialize};

use crate::model::{
    Arrival, ChaosAction, ChaosEvent, Design, EdgeSpec, ExecModel, NodeConfig, NodeKind, NodeSpec,
    Scenario, SimInput, Slo, TrafficPhase,
};
use crate::sim::Simulation;

const Z99: f64 = 2.326_347_874;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub name: String,
    pub vcpu: u32,
    pub ram_gb: f64,
    pub price_per_month: f64,
    /// Dedicated cores. Shared vCPUs lose time to noisy neighbours (steal).
    #[serde(default)]
    pub dedicated: bool,
}

/// Generic reference plans; edit prices to match your provider.
pub fn default_plans() -> Vec<Plan> {
    let p = |name: &str, vcpu, ram_gb, price, dedicated| Plan {
        name: name.into(),
        vcpu,
        ram_gb,
        price_per_month: price,
        dedicated,
    };
    vec![
        p("Shared 1 vCPU / 2 GB", 1, 2.0, 6.0, false),
        p("Shared 2 vCPU / 4 GB", 2, 4.0, 12.0, false),
        p("Shared 4 vCPU / 8 GB", 4, 8.0, 24.0, false),
        p("Shared 8 vCPU / 16 GB", 8, 16.0, 48.0, false),
        p("Shared 16 vCPU / 32 GB", 16, 32.0, 96.0, false),
        p("Dedicated 2 vCPU / 8 GB", 2, 8.0, 42.0, true),
        p("Dedicated 4 vCPU / 16 GB", 4, 16.0, 84.0, true),
        p("Dedicated 8 vCPU / 32 GB", 8, 32.0, 168.0, true),
        p("Dedicated 16 vCPU / 64 GB", 16, 64.0, 336.0, true),
    ]
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct TrafficSpec {
    /// Peak requests per second. If 0, derived from the fields below.
    pub peak_rps: f64,
    pub daily_active_users: f64,
    pub requests_per_user: f64,
    /// Peak hour vs daily average.
    pub peak_factor: f64,
    /// Short spikes (promotions, retries) on top of the peak.
    pub burst_factor: f64,
}

impl Default for TrafficSpec {
    fn default() -> Self {
        Self {
            peak_rps: 0.0,
            daily_active_users: 50_000.0,
            requests_per_user: 40.0,
            peak_factor: 6.0,
            burst_factor: 1.5,
        }
    }
}

impl TrafficSpec {
    pub fn peak(&self) -> f64 {
        if self.peak_rps > 0.0 {
            self.peak_rps
        } else {
            self.daily_active_users * self.requests_per_user / 86_400.0 * self.peak_factor
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSpec {
    /// CPU per request measured on your machine (see tools/k6).
    pub cpu_ms_p50: f64,
    pub cpu_ms_p99: f64,
    pub queries_per_request: u32,
    /// Resident memory of one Node process under load.
    pub ram_mb_per_process: f64,
    /// Prisma `connection_limit` / TypeORM `extra.max`, per process.
    pub pool_per_process: u32,
}

impl Default for AppSpec {
    fn default() -> Self {
        Self {
            cpu_ms_p50: 4.0,
            cpu_ms_p99: 12.0,
            queries_per_request: 3,
            ram_mb_per_process: 200.0,
            pool_per_process: 10,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct DbSpec {
    /// Query time at low load (from `pg_stat_statements` or ORM logs).
    pub query_ms_p50: f64,
    pub query_ms_p99: f64,
    /// Share of the query time spent on CPU (rest: disk/locks).
    pub cpu_fraction: f64,
    /// Postgres `max_connections`.
    pub max_connections: u32,
    /// Working set that should fit in RAM.
    pub hot_data_gb: f64,
}

impl Default for DbSpec {
    fn default() -> Self {
        Self {
            query_ms_p50: 2.0,
            query_ms_p99: 10.0,
            cpu_fraction: 0.5,
            max_connections: 100,
            hot_data_gb: 4.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct SizingSpec {
    pub traffic: TrafficSpec,
    pub app: AppSpec,
    pub db: DbSpec,
    /// VPS vCPU speed relative to the machine you measured on (a laptop
    /// core is often 1.5-2x a cloud vCPU).
    pub cpu_speed_ratio: f64,
    pub response_kb: f64,
    /// One-way latency from users to the servers.
    pub client_latency_ms: f64,
    pub slo: Slo,
    /// Rule-of-thumb ceiling for the analytic pick.
    pub target_utilization: f64,
    /// Require surviving the loss of one app server (N+1).
    pub redundancy: bool,
    pub plans: Vec<Plan>,
    pub load_balancer_per_month: f64,
    /// Hidden cost per server per month: monitoring, backups, patching
    /// time. Stops the search from preferring a swarm of tiny VPS.
    pub ops_per_server_month: f64,
    pub max_app_servers: u32,
    /// Simulated seconds per check.
    pub sim_seconds: f64,
    /// Candidates to simulate at most.
    pub max_simulated: usize,
    pub seed: u64,
}

impl Default for SizingSpec {
    fn default() -> Self {
        Self {
            traffic: TrafficSpec::default(),
            app: AppSpec::default(),
            db: DbSpec::default(),
            cpu_speed_ratio: 0.6,
            response_kb: 5.0,
            client_latency_ms: 10.0,
            slo: Slo {
                p99_ms: 300.0,
                error_rate: 0.01,
            },
            target_utilization: 0.6,
            redundancy: true,
            plans: default_plans(),
            load_balancer_per_month: 10.0,
            ops_per_server_month: 8.0,
            max_app_servers: 12,
            sim_seconds: 20.0,
            max_simulated: 10,
            seed: 7,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Analytic {
    pub peak_rps: f64,
    pub design_rps: f64,
    /// Mean CPU per request on the target vCPU, ms.
    pub app_cpu_ms: f64,
    /// Cores busy at peak (utilization law).
    pub app_cores_busy: f64,
    /// Cores to provision at the target utilization, burst included.
    pub app_cores_needed: f64,
    pub app_ram_gb_per_core: f64,
    pub db_cores_busy: f64,
    pub db_cores_needed: f64,
    /// DB connections busy on average at peak (rps × queries × query time).
    pub db_connections_busy: f64,
    pub bandwidth_mbps: f64,
    pub monthly_traffic_gb: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    pub rps: f64,
    pub required: bool,
    pub pass: bool,
    pub p50_ms: f64,
    pub p99_ms: f64,
    pub error_rate: f64,
    /// Peak app CPU / DB CPU / pool utilization seen during the check.
    pub app_utilization: f64,
    pub db_utilization: f64,
    pub pool_utilization: f64,
    pub event_loop_lag_ms: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub app_plan: Plan,
    pub app_servers: u32,
    pub db_plan: Plan,
    pub monthly_cost: f64,
    pub pool_per_process: u32,
    /// Analytic utilizations at peak.
    pub app_utilization: f64,
    pub db_utilization: f64,
    /// Meets `targetUtilization` analytically (the rule-of-thumb pick).
    pub analytic_ok: bool,
    pub checks: Vec<Check>,
    pub simulated: bool,
    pub pass: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SizingReport {
    pub analytic: Analytic,
    pub candidates: Vec<Candidate>,
    /// Index into `candidates` of the cheapest one passing every check.
    pub recommended: Option<usize>,
    /// Index of the cheapest candidate meeting the rule of thumb.
    pub rule_of_thumb: Option<usize>,
    pub notes: Vec<String>,
    /// Peak scenario of the recommended (or best) candidate, for the sandbox.
    pub input: Option<SimInput>,
}

/// Keep generated designs readable (and their JSON short).
fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn r4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

fn lognormal_mean(p50: f64, p99: f64) -> f64 {
    let p99 = p99.max(p50);
    if p50 <= 0.0 {
        return 0.0;
    }
    let s = libm::log(p99 / p50) / Z99;
    p50 * libm::exp(s * s / 2.0)
}

struct Shape<'a> {
    spec: &'a SizingSpec,
    app: &'a Plan,
    servers: u32,
    db: &'a Plan,
    pool: u32,
}

fn speed(spec: &SizingSpec, plan: &Plan) -> (f64, f64) {
    // shared vCPUs: ~15% lost to steal time and a fatter tail
    if plan.dedicated {
        (spec.cpu_speed_ratio.max(0.05), 1.0)
    } else {
        (spec.cpu_speed_ratio.max(0.05) * 0.85, 1.5)
    }
}

/// Node.js cluster (one process per vCPU) behind a load balancer, Prisma
/// pool to a single Postgres server.
fn build_design(s: &Shape) -> Design {
    let spec = s.spec;
    let (app_speed, app_tail) = speed(spec, s.app);
    let (db_speed, db_tail) = speed(spec, s.db);
    let q50 = spec.db.query_ms_p50.max(0.01);
    let q99 = spec.db.query_ms_p99.max(q50);
    let cpu_f = spec.db.cpu_fraction.clamp(0.0, 1.0);
    let mut nodes = vec![NodeSpec {
        id: "users".into(),
        kind: NodeKind::Client,
        config: NodeConfig::default(),
    }];
    let mut edges = vec![];
    let entry = if s.servers > 1 {
        nodes.push(NodeSpec {
            id: "lb".into(),
            kind: NodeKind::LoadBalancer,
            config: NodeConfig {
                concurrency: 100_000,
                queue_size: 0,
                latency_p50_ms: 0.2,
                latency_p99_ms: 1.0,
                cost_per_hour: r4(spec.load_balancer_per_month / 730.0),
                ..NodeConfig::default()
            },
        });
        edges.push(EdgeSpec::new("users", "lb", spec.client_latency_ms));
        "lb"
    } else {
        "app"
    };
    nodes.push(NodeSpec {
        id: "app".into(),
        kind: NodeKind::Service,
        config: NodeConfig {
            instances: s.servers,
            model: ExecModel::Cpu,
            cpu_lanes: s.app.vcpu.max(1),
            max_in_flight: 5_000,
            queue_size: 0,
            cpu_p50_ms: r2(spec.app.cpu_ms_p50 / app_speed),
            cpu_p99_ms: r2(spec.app.cpu_ms_p99.max(spec.app.cpu_ms_p50) / app_speed * app_tail),
            calls_per_request: spec.app.queries_per_request.max(1),
            cost_per_hour: r4(s.app.price_per_month / 730.0),
            ..NodeConfig::default()
        },
    });
    if entry == "lb" {
        edges.push(EdgeSpec::new("lb", "app", 0.3));
    } else {
        edges.push(EdgeSpec::new("users", "app", spec.client_latency_ms));
    }
    if spec.app.queries_per_request > 0 {
        nodes.push(NodeSpec {
            id: "db".into(),
            kind: NodeKind::Database,
            config: NodeConfig {
                model: ExecModel::Cpu,
                cpu_lanes: s.db.vcpu.max(1),
                max_in_flight: spec.db.max_connections.max(1),
                queue_size: 0,
                cpu_p50_ms: r2(q50 * cpu_f / db_speed),
                cpu_p99_ms: r2(q99 * cpu_f / db_speed * db_tail),
                io_p50_ms: r2(q50 * (1.0 - cpu_f)),
                io_p99_ms: r2(q99 * (1.0 - cpu_f)),
                cost_per_hour: r4(s.db.price_per_month / 730.0),
                ..NodeConfig::default()
            },
        });
        let mut e = EdgeSpec::new("app", "db", 0.3);
        e.pool_size = Some(s.pool.max(1));
        edges.push(e);
    }
    Design { nodes, edges }
}

fn scenario(spec: &SizingSpec, rps: f64, events: Vec<ChaosEvent>) -> Scenario {
    Scenario {
        seed: spec.seed,
        duration_ms: Some(spec.sim_seconds.max(5.0) * 1000.0),
        timeout_ms: 10_000.0,
        traffic: vec![TrafficPhase { at_ms: 0.0, rps }],
        slo: spec.slo,
        window_ms: 1000.0,
        events,
        budget_per_hour: None,
        arrival: Arrival::Poisson,
        chaos_monkey: None,
        max_concurrent: None,
    }
}

fn run_check(
    name: &str,
    design: Design,
    scenario: Scenario,
    required: bool,
) -> Result<Check, String> {
    let rps = scenario.traffic[0].rps;
    let app = design.nodes.iter().position(|n| n.id == "app");
    let db = design.nodes.iter().position(|n| n.id == "db");
    let pool = design.edges.iter().position(|e| e.pool_size.is_some());
    let input = SimInput { design, scenario };
    let mut sim = Simulation::new(&input, false)?;
    sim.run_to_end()?;
    let s = sim.summary();
    let w = sim.take_windows();
    let peak =
        |f: &dyn Fn(&crate::sim::WindowMetrics) -> f64| w.iter().skip(1).map(f).fold(0.0, f64::max);
    Ok(Check {
        name: name.into(),
        rps,
        required,
        pass: s.slo_pass,
        p50_ms: s.p50_ms,
        p99_ms: s.p99_ms,
        error_rate: s.error_rate,
        app_utilization: app.map_or(0.0, |i| peak(&|w| w.nodes[i].utilization)),
        db_utilization: db.map_or(0.0, |i| peak(&|w| w.nodes[i].utilization)),
        pool_utilization: pool.map_or(0.0, |i| peak(&|w| w.edges[i].pool_utilization)),
        event_loop_lag_ms: app.map_or(0.0, |i| peak(&|w| w.nodes[i].lag_ms)),
    })
}

fn checks(
    spec: &SizingSpec,
    shape: &Shape,
    peak: f64,
    design_rps: f64,
) -> Result<Vec<Check>, String> {
    let design = build_design(shape);
    let mut out = vec![
        run_check(
            "Cao điểm",
            design.clone(),
            scenario(spec, peak, vec![]),
            true,
        )?,
        run_check(
            &format!("Đột biến ×{}", spec.traffic.burst_factor),
            design.clone(),
            scenario(spec, design_rps, vec![]),
            true,
        )?,
    ];
    if shape.servers > 1 {
        let fewer = build_design(&Shape {
            servers: shape.servers - 1,
            ..*shape
        });
        out.push(run_check(
            "Mất 1 app server",
            fewer,
            scenario(spec, peak, vec![]),
            spec.redundancy,
        )?);
    }
    if design.nodes.iter().any(|n| n.id == "db") {
        let slow = vec![ChaosEvent {
            at_ms: 0.0,
            node: "db".into(),
            nodes: vec![],
            edge: None,
            action: ChaosAction::Latency,
            value: 2.0,
        }];
        out.push(run_check(
            "DB chậm ×2 (backup, vacuum)",
            design,
            scenario(spec, peak, slow),
            false,
        )?);
    }
    Ok(out)
}

pub fn size(spec: &SizingSpec) -> Result<SizingReport, String> {
    if spec.plans.is_empty() {
        return Err("no plans to choose from".into());
    }
    let peak = spec.traffic.peak();
    if peak.is_nan() || peak <= 0.0 {
        return Err("peak traffic must be > 0".into());
    }
    let burst = spec.traffic.burst_factor.max(1.0);
    let design_rps = peak * burst;
    let target = spec.target_utilization.clamp(0.1, 0.95);
    let queries = spec.app.queries_per_request as f64;
    let ratio = spec.cpu_speed_ratio.max(0.05);
    let app_cpu_ms = lognormal_mean(spec.app.cpu_ms_p50, spec.app.cpu_ms_p99) / ratio;
    let q_mean = lognormal_mean(spec.db.query_ms_p50, spec.db.query_ms_p99);
    let db_cpu_ms = q_mean * spec.db.cpu_fraction.clamp(0.0, 1.0) / ratio;
    let app_cores_busy = peak * app_cpu_ms / 1000.0;
    let db_cores_busy = peak * queries * db_cpu_ms / 1000.0;
    let avg_rps = if spec.traffic.peak_rps > 0.0 {
        peak / 5.0
    } else {
        peak / spec.traffic.peak_factor.max(1.0)
    };
    let analytic = Analytic {
        peak_rps: peak,
        design_rps,
        app_cpu_ms,
        app_cores_busy,
        app_cores_needed: design_rps * app_cpu_ms / 1000.0 / target,
        app_ram_gb_per_core: spec.app.ram_mb_per_process / 1024.0,
        db_cores_busy,
        db_cores_needed: design_rps * queries * db_cpu_ms / 1000.0 / target,
        db_connections_busy: peak * queries * (q_mean + 0.6) / 1000.0,
        bandwidth_mbps: design_rps * spec.response_kb * 8.0 / 1000.0,
        monthly_traffic_gb: avg_rps * spec.response_kb * 86_400.0 * 30.0 / 1e6,
    };
    let mut notes = vec![];

    // enumerate shapes
    let min_servers = if spec.redundancy { 2 } else { 1 };
    let mut cands: Vec<Candidate> = vec![];
    let db_needed = queries > 0.0;
    let db_plans: Vec<&Plan> = if db_needed {
        spec.plans
            .iter()
            .filter(|p| p.ram_gb >= spec.db.hot_data_gb * 1.25 + 1.0)
            .collect()
    } else {
        spec.plans.iter().take(1).collect()
    };
    if db_plans.is_empty() {
        return Err(format!(
            "no plan has enough RAM for {} GB of hot data",
            spec.db.hot_data_gb
        ));
    }
    for app in &spec.plans {
        let ram_need = app.vcpu as f64 * spec.app.ram_mb_per_process / 1024.0 + 0.5;
        if app.ram_gb < ram_need {
            continue;
        }
        let (app_speed, _) = speed(spec, app);
        for servers in min_servers..=spec.max_app_servers.max(min_servers) {
            let cores = (servers * app.vcpu) as f64;
            let app_u = peak * app_cpu_ms * ratio / app_speed / 1000.0 / cores;
            let app_u_burst = app_u * burst;
            // with one server lost, if required
            let app_u_n1 = if spec.redundancy && servers > 1 {
                app_u * servers as f64 / (servers - 1) as f64
            } else {
                app_u
            };
            if app_u_burst > 0.92 || app_u_n1 > 0.92 {
                continue;
            }
            for db in &db_plans {
                let (db_speed, _) = speed(spec, db);
                let db_u = if db_needed {
                    peak * queries * db_cpu_ms * ratio / db_speed / 1000.0 / db.vcpu as f64
                } else {
                    0.0
                };
                if db_u * burst > 0.92 {
                    continue;
                }
                let processes = servers * app.vcpu;
                let max_pool =
                    ((spec.db.max_connections as f64 * 0.9) / processes as f64).floor() as u32;
                let pool = spec.app.pool_per_process.min(max_pool.max(1));
                let lb = if servers > 1 {
                    spec.load_balancer_per_month
                } else {
                    0.0
                };
                cands.push(Candidate {
                    app_plan: app.clone(),
                    app_servers: servers,
                    db_plan: (*db).clone(),
                    monthly_cost: servers as f64
                        * (app.price_per_month + spec.ops_per_server_month)
                        + if db_needed {
                            db.price_per_month + spec.ops_per_server_month
                        } else {
                            0.0
                        }
                        + lb,
                    pool_per_process: pool,
                    app_utilization: app_u,
                    db_utilization: db_u,
                    analytic_ok: app_u * burst <= target && db_u * burst <= target,
                    checks: vec![],
                    simulated: false,
                    pass: false,
                });
            }
        }
    }
    if cands.is_empty() {
        let biggest = db_plans.iter().map(|p| p.vcpu).max().unwrap_or(1) as f64;
        if db_needed && db_cores_busy * burst > biggest * 0.92 {
            return Err(format!(
                "Postgres cần ~{:.0} core lúc đột biến, vượt gói lớn nhất ({biggest} vCPU): thêm cache, read replica hoặc giảm số query mỗi request",
                db_cores_busy * burst
            ));
        }
        return Err(
            "không tổ hợp gói nào gánh được tải này: thêm gói lớn hơn hoặc tăng maxAppServers"
                .into(),
        );
    }
    // cheapest first; on ties prefer more headroom
    cands.sort_by(|a, b| {
        a.monthly_cost.total_cmp(&b.monthly_cost).then(
            a.app_utilization
                .max(a.db_utilization)
                .total_cmp(&b.app_utilization.max(b.db_utilization)),
        )
    });
    cands.truncate(60);

    let mut recommended = None;
    let mut simulated = 0;
    #[allow(clippy::needless_range_loop)] // candidates are mutated in place
    for i in 0..cands.len() {
        if simulated >= spec.max_simulated {
            break;
        }
        let c = &cands[i];
        let shape = Shape {
            spec,
            app: &c.app_plan,
            servers: c.app_servers,
            db: &c.db_plan,
            pool: c.pool_per_process,
        };
        let result = checks(spec, &shape, peak, design_rps)?;
        simulated += 1;
        let c = &mut cands[i];
        c.pass = result.iter().all(|k| k.pass || !k.required);
        c.checks = result;
        c.simulated = true;
        if c.pass {
            recommended = Some(i);
            break;
        }
    }
    let rule_of_thumb = cands.iter().position(|c| c.analytic_ok);

    if let Some(c) = recommended.map(|i| &cands[i]) {
        if c.pool_per_process < spec.app.pool_per_process {
            notes.push(format!(
                "Giảm pool xuống {} kết nối mỗi process: {} process × {} vượt max_connections = {} của Postgres.",
                c.pool_per_process,
                c.app_servers * c.app_plan.vcpu,
                spec.app.pool_per_process,
                spec.db.max_connections
            ));
        }
        if !c.app_plan.dedicated {
            notes.push("vCPU dùng chung: kiểm tra %st (steal) trong top khi chạy thật. Nếu >5% thường xuyên, chuyển sang gói dedicated.".into());
        }
        if let Some(k) = c.checks.iter().find(|k| !k.required && !k.pass) {
            notes.push(format!(
                "Kịch bản \"{}\" không đạt SLO (p99 {:.0} ms, lỗi {:.1}%): cân nhắc dư địa thêm hoặc cache.",
                k.name,
                k.p99_ms,
                k.error_rate * 100.0
            ));
        }
    } else {
        notes.push(format!(
            "Không phương án nào trong {} phương án rẻ nhất đạt mọi kiểm tra. Tăng maxSimulated, thêm gói lớn hơn hoặc nới SLO.",
            simulated
        ));
    }
    notes.push(
        "Node chạy đơn luồng: chạy 1 process mỗi vCPU (PM2 `-i max` hoặc cluster), mỗi process có pool kết nối riêng."
            .into(),
    );

    let best = recommended.or_else(|| {
        cands
            .iter()
            .enumerate()
            .filter(|(_, c)| c.simulated)
            .min_by(|a, b| {
                let f = |c: &Candidate| c.checks.iter().filter(|k| !k.pass && k.required).count();
                f(a.1).cmp(&f(b.1))
            })
            .map(|(i, _)| i)
    });
    let input = best.map(|i| {
        let c = &cands[i];
        SimInput {
            design: build_design(&Shape {
                spec,
                app: &c.app_plan,
                servers: c.app_servers,
                db: &c.db_plan,
                pool: c.pool_per_process,
            }),
            scenario: Scenario {
                duration_ms: Some(60_000.0),
                traffic: vec![
                    TrafficPhase {
                        at_ms: 0.0,
                        rps: peak,
                    },
                    TrafficPhase {
                        at_ms: 30_000.0,
                        rps: design_rps,
                    },
                    TrafficPhase {
                        at_ms: 40_000.0,
                        rps: peak,
                    },
                ],
                ..scenario(spec, peak, vec![])
            },
        }
    });
    Ok(SizingReport {
        analytic,
        candidates: cands,
        recommended,
        rule_of_thumb,
        notes,
        input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(peak: f64) -> SizingSpec {
        SizingSpec {
            traffic: TrafficSpec {
                peak_rps: peak,
                ..TrafficSpec::default()
            },
            sim_seconds: 8.0,
            ..SizingSpec::default()
        }
    }

    #[test]
    fn derives_peak_from_daily_users() {
        let t = TrafficSpec::default(); // 50k users × 40 req / 86400 s × 6
        assert!((t.peak() - 138.9).abs() < 0.1, "peak = {}", t.peak());
    }

    #[test]
    fn recommends_a_passing_plan_that_scales_with_load() {
        let small = size(&spec(150.0)).unwrap();
        let big = size(&spec(1500.0)).unwrap();
        let s = &small.candidates[small.recommended.expect("small fits")];
        let b = &big.candidates[big.recommended.expect("big fits")];
        assert!(s.pass && b.pass);
        assert!(
            b.monthly_cost > s.monthly_cost * 2.0,
            "{} vs {}",
            b.monthly_cost,
            s.monthly_cost
        );
        assert!(s.app_servers >= 2, "N+1 redundancy");
        // the analytic estimate agrees with the plan within reason
        let cores = (b.app_servers * b.app_plan.vcpu) as f64;
        assert!(cores >= big.analytic.app_cores_busy * 1.2, "{cores} cores");
        assert!(big.input.is_some());
    }

    #[test]
    fn caps_pool_size_to_postgres_max_connections() {
        let mut sp = spec(1200.0);
        sp.db.max_connections = 60;
        let r = size(&sp).unwrap();
        let c = &r.candidates[r.recommended.unwrap_or(0)];
        let processes = c.app_servers * c.app_plan.vcpu;
        assert!(
            c.pool_per_process * processes <= 54,
            "{} × {}",
            c.pool_per_process,
            processes
        );
    }

    #[test]
    fn redundancy_check_fails_when_one_server_is_not_enough() {
        // 2 servers each just big enough for half the load cannot lose one
        let r = size(&spec(600.0)).unwrap();
        let rec = r.recommended.unwrap();
        for c in r.candidates.iter().take(rec).filter(|c| c.simulated) {
            assert!(!c.pass);
        }
        let c = &r.candidates[rec];
        let lost = c.checks.iter().find(|k| k.name.starts_with("Mất")).unwrap();
        assert!(lost.pass, "recommended survives losing a server");
    }
}
