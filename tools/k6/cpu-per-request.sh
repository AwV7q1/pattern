#!/usr/bin/env bash
# Measure CPU time per request of a running server (input for the sizing
# wizard: "CPU ms / request").
#
#   tools/k6/cpu-per-request.sh <pids> <url> [rate=20] [seconds=60]
#
#   <pids>  comma-separated PIDs of every server process (PM2 cluster:
#           `pm2 jlist | jq -r '[.[].pid]|join(",")'`, or `pgrep -d, -f dist/main`)
#
# Runs a light constant-rate k6 test (low load, so no queueing), reads the
# processes' CPU time before and after, and divides by the request count.
set -euo pipefail

PIDS=${1:?usage: $0 <pid[,pid...]> <url> [rate] [seconds]}
URL=${2:?missing url}
RATE=${3:-20}
SECS=${4:-60}
DIR=$(cd "$(dirname "$0")" && pwd)
TICKS=$(getconf CLK_TCK 2>/dev/null || echo 100)

cpu_ms() {
  local total=0 pid
  for pid in ${PIDS//,/ }; do
    if [[ -r /proc/$pid/stat ]]; then
      # utime + stime (fields 14, 15) in clock ticks; strip "pid (comm)" first
      local rest
      rest=$(sed 's/^.*) //' "/proc/$pid/stat")
      read -r -a f <<<"$rest"
      total=$((total + (f[11] + f[12]) * 1000 / TICKS))
    else
      # macOS / BSD: "[[dd-]hh:]mm:ss.cc"
      local t
      t=$(ps -o time= -p "$pid" | tr -d ' ')
      total=$((total + $(awk -F'[:.-]' '{ n=NF; ms=$n*10; s=$(n-1); m=$(n-2); h=(n>3)?$(n-3):0; d=(n>4)?$(n-4):0; print ms + 1000*(s + 60*m + 3600*h + 86400*d) }' <<<"$t")))
    fi
  done
  echo "$total"
}

SUMMARY=$(mktemp)
before=$(cpu_ms)
k6 run -q -e BASE_URL="$URL" -e RATES="$RATE" -e STEP="${SECS}s" -e GAP=1s \
  --summary-export="$SUMMARY" "$DIR/step-load.js" >/dev/null
after=$(cpu_ms)

node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).metrics;
const k = Object.keys(s).find((k) => k.startsWith("http_reqs{"));
const reqs = s[k].count;
const cpu = Number(process.argv[2]);
const d = s[Object.keys(s).find((k) => k.startsWith("http_req_duration{"))];
console.log(`requests        ${reqs}`);
console.log(`CPU time        ${cpu} ms`);
console.log(`CPU / request   ${(cpu / reqs).toFixed(2)} ms   <- cpuMsP50 (mean; p99 ≈ 2-3x unless you profile)`);
console.log(`latency p50/p99 ${d.med.toFixed(1)} / ${d["p(99)"].toFixed(1)} ms (low load: no queueing)`);
' "$SUMMARY" "$((after - before))"
rm -f "$SUMMARY"
