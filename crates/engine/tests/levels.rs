//! Every shipped level must be lost by its starting design and won (3 stars)
//! by its reference solution, so levels stay solvable as the engine evolves.

use pattern_engine::{Design, Level};

fn load(path: &std::path::Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../levels")
}

/// Plays every level in `dir` (and its `solutions/`), returns how many.
fn check_dir(dir: &std::path::Path) -> usize {
    let mut count = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        count += 1;
        let level: Level = serde_json::from_str(&load(&path)).unwrap();
        let start = level.play(&level.design).unwrap();
        assert_eq!(start.stars, 0, "{}: starting design should lose", level.id);

        let solution_path = dir.join("solutions").join(path.file_name().unwrap());
        let solution: Design = serde_json::from_str(&load(&solution_path)).unwrap();
        let s = level.play(&solution).unwrap();
        assert_eq!(s.stars, 3, "{}: reference solution got {s:?}", level.id);
    }
    count
}

#[test]
fn levels_are_solvable_and_not_trivial() {
    let count = check_dir(&root());
    assert!(count >= 4, "found {count} levels");
}

#[test]
fn learning_path_levels_are_solvable() {
    let count = check_dir(&root().join("learn"));
    assert!(count >= 3, "found {count} learn levels");
}

#[test]
fn required_calls_cannot_be_deleted() {
    let path = root().join("learn/02-product-page.json");
    let level: Level = serde_json::from_str(&load(&path)).unwrap();
    let mut design = level.design.clone();
    design.edges.retain(|e| e.target != "prices");
    let err = level.build_input(&design).unwrap_err();
    assert!(err.contains("page -> prices"), "{err}");
}

#[test]
fn fire_and_forget_needs_level_permission() {
    let mut level: Level =
        serde_json::from_str(&load(&root().join("learn/03-signup-email.json"))).unwrap();
    let solution: Design =
        serde_json::from_str(&load(&root().join("learn/solutions/03-signup-email.json"))).unwrap();
    level.allow_fire_and_forget = false;
    assert_eq!(level.play(&solution).unwrap().stars, 0);
}

#[test]
fn players_cannot_edit_catalog_numbers() {
    let root = root();
    let level: Level = serde_json::from_str(&load(&root.join("01-first-sale.json"))).unwrap();
    let mut design: Design =
        serde_json::from_str(&load(&root.join("solutions/01-first-sale.json"))).unwrap();
    let honest = level.play(&design).unwrap();
    for n in &mut design.nodes {
        n.config.cost_per_hour = 0.0;
        n.config.concurrency = 1_000_000;
        n.config.instances = 1_000;
    }
    design.edges[0].latency_ms = 0.0;
    let input = level.build_input(&design).unwrap();
    assert!(input
        .design
        .nodes
        .iter()
        .all(|n| n.config.instances <= level.max_instances));
    let cheat = level.play(&design).unwrap();
    assert!(cheat.cost_per_hour >= honest.cost_per_hour);
    assert_eq!(input.design.edges[0].latency_ms, level.client_latency_ms);

    // locked nodes cannot be removed
    design.nodes.retain(|n| n.id != "db");
    assert!(level.build_input(&design).is_err());
}
