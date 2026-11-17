//! Prints the JSON summary of a scenario file (used to compare native vs WASM output).
fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: summary <scenario.json>");
    let input = std::fs::read_to_string(path).expect("read scenario");
    let summary = pattern_engine::run_headless(&input).expect("run scenario");
    println!("{}", serde_json::to_string(&summary).unwrap());
}
