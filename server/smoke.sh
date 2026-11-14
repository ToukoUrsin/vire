#!/usr/bin/env bash
# End-to-end walk of the Vire API. Usage: ./smoke.sh [base]   (default http://127.0.0.1:8871)
# Creates one real user called "Smoke test"; point it at a test instance to keep the main database clean:
#   PORT=8872 VIRE_DB=/tmp/vire-smoke.sqlite bun index.ts &   then   ./smoke.sh http://127.0.0.1:8872
set -euo pipefail
BASE="${1:-http://127.0.0.1:8871}"
fail() { echo "FAIL: $*" >&2; exit 1; }
j() { bun -e 'const d=JSON.parse(await Bun.stdin.text()); const v=(new Function("d","return "+process.argv[1]))(d); console.log(typeof v==="string"?v:JSON.stringify(v))' "$1"; }
post() { curl -sf -X POST "$BASE$1" -H 'content-type: application/json' -d "$2"; }
get() { curl -sf "$BASE$1"; }

[ "$(get /api/health | j d.ok)" = true ] || fail health
echo "ok  health"

USER=$(post /api/users '{"name":"Smoke test"}' | j d.userId)
[ -n "$USER" ] || fail "create user"
echo "ok  user $USER"

ping() { # day-offset kind smileAuc f0Sd swing nodVel
  local at; at=$(date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ)
  post /api/pings "{\"userId\":\"$USER\",\"kind\":\"$2\",\"setting\":\"home\",\"startedAt\":\"$at\",
    \"features\":{\"smile\":{\"latencyMs\":620,\"peak\":0.5,\"auc\":$3,\"duchenne\":0.4,\"durationMs\":2400,\"baseline\":0.1},
      \"voice\":{\"speechFraction\":0.6,\"pauseCount\":3,\"meanPauseMs\":420,\"f0MedianHz\":180,\"f0SdSemitones\":$4,\"loudnessSdDb\":5,\"syllableRateHz\":3.8},
      \"heart\":{\"restBpm\":66,\"swingBpm\":$5,\"quality\":0.8,\"source\":\"camera\"},
      \"move\":{\"nodAmplitudeDeg\":14,\"nodPeakVelDegS\":$6,\"nodCount\":2,\"restlessness\":1.2,\"source\":\"camera\"}},
    \"device\":{\"ua\":\"smoke\",\"native\":false,\"airpodsMotion\":false,\"airpodsHr\":false}}"
}

E1=$(ping 3 full 1.7 2.5 9.5 62); [ "$(echo "$E1" | j d.status)" = calibrating ] || fail "first ping should be calibrating: $E1"
E2=$(ping 2 full 1.5 2.3 8.8 58)
E3=$(ping 1 full 1.6 2.4 9.1 61)
E4=$(ping 0 full 1.3 2.0 7.6 50)
[ "$(echo "$E4" | j 'd.components.length')" = 4 ] || fail "echo needs 4 components"
[ "$(echo "$E4" | j 'd.components.every(c=>typeof c.z==="number")')" = true ] || fail "z should exist after 3 pings: $E4"
[ "$(echo "$E4" | j 'd.strength<50')" = true ] || fail "a flat 4th ping should read below usual: $E4"
PRE=$(echo "$E4" | j d.pingId)
echo "ok  4 pings; 4th: strength $(echo "$E4" | j d.strength), status $(echo "$E4" | j d.status)"
echo "    message: $(echo "$E4" | j d.message)"

[ "$(get "/api/users/$USER/echoes" | j d.length)" = 4 ] || fail "echoes should list 4"
echo "ok  echoes 4"

S1=$(get "/api/users/$USER/suggestion"); D1=$(echo "$S1" | j d.dose)
[ -n "$D1" ] && [ "$D1" != undefined ] || fail "suggestion: $S1"
echo "ok  suggestion $D1: $(echo "$S1" | j d.reason)"

M=$(ping 0 mini 1.65 2.4 9.2 60); POST=$(echo "$M" | j d.pingId)
[ "$(echo "$M" | j 'd.components.filter(c=>c.value!=null).length')" = 2 ] || fail "mini ping scores smile and heart only: $M"
R=$(post /api/doses "{\"userId\":\"$USER\",\"dose\":\"$D1\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"durationS\":180,\"prePingId\":\"$PRE\",\"postPingId\":\"$POST\",\"felt\":1,\"metrics\":{\"breathsPerMin\":6}}")
[ "$(echo "$R" | j 'd.reward>0')" = true ] || fail "the dose lifted the echo, reward should be positive: $R"
[ "$(echo "$R" | j "d.beliefs.find(b=>b.dose==='$D1').n")" = 1 ] || fail "belief should count the dose: $R"
echo "ok  dose $D1 reward $(echo "$R" | j d.reward): $(echo "$R" | j d.message)"

S2=$(get "/api/users/$USER/suggestion")
[ -n "$(echo "$S2" | j d.dose)" ] || fail "suggestion after dose"
echo "ok  suggestion again $(echo "$S2" | j d.dose): $(echo "$S2" | j d.reason)"

ROW=$(get /api/clinic/patients | j "d.find(p=>p.id==='$USER')")
[ "$(echo "$ROW" | j 'd.synthetic===false && d.name==="Smoke test" && d.priority>=0 && d.priority<=1')" = true ] || fail "clinic row: $ROW"
[ "$(get /api/clinic/patients | j 'd.filter(p=>p.synthetic).length')" = 24 ] || fail "24 synthetic patients"
echo "ok  clinic lists the user (priority $(echo "$ROW" | j d.priority)): $(echo "$ROW" | j d.reason)"
DET=$(get "/api/clinic/patients/$USER")
[ "$(echo "$DET" | j 'd.timeline.length===5 && d.signature.length===4 && d.beliefs.length===4 && d.doses.length===1 && d.summary.length>20')" = true ] || fail "detail: $DET"
echo "ok  detail: $(echo "$DET" | j d.summary)"

[ "$(get "/api/users/$USER/notice" | j d.booster)" = false ] || fail "notice should start off"
post "/api/clinic/patients/$USER/booster" '{"on":true}' >/dev/null
N=$(get "/api/users/$USER/notice")
[ "$(echo "$N" | j d.booster)" = true ] || fail "notice after booster: $N"
[ "$(get "/api/clinic/patients/$USER" | j d.boosterRequested)" = true ] || fail "row should show the booster"
echo "ok  booster on -> notice: $(echo "$N" | j d.message)"
post "/api/clinic/patients/$USER/booster" '{"on":false}' >/dev/null
[ "$(get "/api/users/$USER/notice" | j d.booster)" = false ] || fail "booster off"
echo "ok  booster off"
echo "SMOKE PASSED"
