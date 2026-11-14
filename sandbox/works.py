"""What works for one patient: shared/earlearn.ts ported line for line, for the clinic's re-training sandbox (no network).

    python3 sandbox/works.py <patient.json>      prints one line {"works": {...}} (or {"error": ...})
    python3 sandbox/works.py --learn             reads {"histories": [[{kind, settle, at}, ...], ...]} on stdin and
                                                 prints {"learned": [...]}: the full answer per history (the TS test)

<patient.json> is what the sandbox gets: {"minutes": [...], "practices": [{kind, settle, at}, ...]}. The practices are
simulated (sandbox/cohort_practices.ts). Same prior, same update, same random numbers (mulberry32 seeded by the same
hash of the same text) and the same rules for best, sure, said and next as the phone and the server.
"""
from __future__ import annotations

import json
import math
import sys

KINDS = ("breathe", "scan", "walk")
# before any session: no change expected, and scores taken to scatter by about 20 points
PRIOR = (0.0, 1.0, 2.0, 400.0)  # mu, kappa, alpha, beta
DRAWS = 2000
M32 = 0xFFFFFFFF


def update(p: tuple, xs: list[float]) -> tuple:
    n = len(xs)
    if not n:
        return p
    mu0, k0, a0, b0 = p
    m = sum(xs) / n  # left to right, as JS reduce
    ss = 0.0
    for x in xs:
        ss += (x - m) ** 2
    kappa = k0 + n
    return ((k0 * mu0 + n * m) / kappa, kappa, a0 + n / 2, b0 + 0.5 * ss + (k0 * n * (m - mu0) ** 2) / (2 * kappa))


def imul(a: int, b: int) -> int:
    return (a * b) & M32


def mulberry32(seed: int):
    state = [seed & M32]

    def rng() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & M32
        t = state[0]
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return rng


def js_hash(s: str) -> int:
    h = 2166136261
    data = s.encode("utf-16-le")  # charCodeAt: UTF-16 code units
    for i in range(0, len(data), 2):
        h = imul(h ^ (data[i] | (data[i + 1] << 8)), 16777619)
    return h & M32


def js_num(v: float) -> str:
    """A number as JS writes it in a template string (`${x}`)."""
    if v != v:
        return "NaN"
    if v == math.inf:
        return "Infinity"
    if v == -math.inf:
        return "-Infinity"
    if v == 0:
        return "0"
    if v == int(v) and abs(v) < 1e21:
        return str(int(v))
    r = repr(float(v))
    if "e" not in r and "E" not in r:
        return r
    mant, exp = r.split("e")
    e = int(exp)
    if -7 < e < 21:  # JS writes these out in full
        digits = mant.replace("-", "").replace(".", "")
        sign = "-" if mant.startswith("-") else ""
        point = (mant.replace("-", "").find(".") if "." in mant else len(mant.replace("-", ""))) + e
        if point <= 0:
            return f"{sign}0.{'0' * -point}{digits}"
        if point >= len(digits):
            return f"{sign}{digits}{'0' * (point - len(digits))}"
        return f"{sign}{digits[:point]}.{digits[point:]}"
    return f"{mant}e{'+' if e > 0 else '-'}{abs(e)}"


def normal(rng) -> float:
    u = max(rng(), 1e-12)
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * rng())


def gamma(alpha: float, rng) -> float:
    """Marsaglia and Tsang; alpha is at least 2 here"""
    d = alpha - 1 / 3
    c = 1 / math.sqrt(9 * d)
    while True:
        x = normal(rng)
        v = (1 + c * x) ** 3
        if v <= 0:
            continue
        if math.log(max(rng(), 1e-12)) < 0.5 * x * x + d - d * v + d * math.log(v):
            return d * v


def draw(p: tuple, rng) -> float:
    mu, kappa, alpha, beta = p
    return mu + normal(rng) / math.sqrt(kappa * (gamma(alpha, rng) / beta))


def round1(v: float) -> float:
    # Math.round: halves go up
    return math.floor(v * 10 + 0.5) / 10


def is_num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def learn(sessions: list[dict], kinds: tuple = KINDS) -> dict:
    scored = [s for s in sessions if isinstance(s, dict) and is_num(s.get("settle")) and s.get("kind") in kinds]

    def of(k: str) -> list[float]:
        return [float(s["settle"]) for s in scored if s["kind"] == k]

    post = {k: update(PRIOR, of(k)) for k in kinds}
    beliefs = []
    for kind in kinds:
        xs = of(kind)
        mu, kappa, alpha, beta = post[kind]
        total = 0.0
        for x in xs:
            total += x
        beliefs.append({"kind": kind, "n": len(xs), "mean": round1(total / len(xs)) if xs else None, "believed": round1(mu), "sd": round1(math.sqrt(beta / (kappa * max(alpha - 1, 0.5))))})
    tried = [b for b in beliefs if b["n"] > 0]
    best = None
    if tried:
        a = tried[0]
        for b in tried[1:]:
            if b["believed"] > a["believed"]:
                a = b
        best = a["kind"]
    # the same sessions always give the same draws, so the screen does not change its mind between two looks
    rng = mulberry32(js_hash("|".join(f"{s['kind']}{s.get('at')}{js_num(float(s['settle']))}" for s in scored)))
    wins = 0
    if best and len(tried) > 1:
        for _ in range(DRAWS):
            top = tried[0]["kind"]
            v = -math.inf
            for b in tried:
                x = draw(post[b["kind"]], rng)
                if x > v:
                    v = x
                    top = b["kind"]
            if top == best:
                wins += 1
    sure = math.floor(wins / DRAWS * 100 + 0.5) / 100 if best and len(tried) > 1 else 0
    best_n = next((b["n"] for b in beliefs if b["kind"] == best), 0)
    compared = len([b for b in tried if b["n"] >= 2])
    if best and best_n >= 3 and compared >= 2 and sure >= 0.8:
        said = "learned"
    elif best and len(tried) >= 2 and len(scored) >= 3:
        said = "leaning"
    else:
        said = "early"
    # next: every kind once, then one draw from each belief and the highest wins
    untried = next((b for b in beliefs if b["n"] == 0), None)
    nxt = untried["kind"] if untried else kinds[0]
    why = "not tried yet"
    if not untried:
        v = -math.inf
        for k in kinds:
            x = draw(post[k], rng)
            if x > v:
                v = x
                nxt = k
        why = "helped most so far" if nxt == best else "still comparing"
    return {"kinds": beliefs, "total": len(scored), "best": best, "sure": sure, "said": said, "next": nxt, "why": why}


def works(practices: list[dict]) -> dict:
    """What the clinic's screen gets for one patient: what helps most, how sure, what comes next, and the counts."""
    got = learn(practices)
    return {
        "best": got["best"],
        "said": got["said"],
        "sure": got["sure"],
        "next": got["next"],
        "total": got["total"],
        "kinds": [{"kind": b["kind"], "n": b["n"], "mean": b["mean"]} for b in got["kinds"]],
    }


def main(argv: list[str]) -> int:
    if argv[1:] == ["--learn"]:
        histories = json.load(sys.stdin)["histories"]
        print(json.dumps({"learned": [learn(h) for h in histories]}))
        return 0
    if len(argv) != 2:
        print(json.dumps({"error": "usage: works.py <patient.json> | --learn"}))
        return 2
    try:
        with open(argv[1], encoding="utf-8") as f:
            practices = json.load(f).get("practices")
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": f"could not read the practices: {type(exc).__name__}"}))
        return 1
    if not isinstance(practices, list):
        print(json.dumps({"error": "no practices for this patient"}))
        return 1
    print(json.dumps({"works": works(practices)}, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
