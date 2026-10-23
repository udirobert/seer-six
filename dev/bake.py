#!/usr/bin/env python3
"""Bake Seer's public API into static ESM data modules for the six surfaces.

Stdlib + curl only (this machine's python has no CA bundle). Never calls
markets-charts without ids= — unfiltered that endpoint returns 4.6 MB.
Every module is byte-budgeted and the script aborts if a page would ship more
than BUDGET bytes, so the payload stays honest instead of quietly bloating.
"""
import json
import re
import subprocess
import time
import zlib
from pathlib import Path

BASE = "https://app.seer.pm/.netlify/functions"
OUT = Path(__file__).resolve().parent.parent / "data"
BUDGET = 110_000
MAX_MARKETS = 250
MAX_PARENT_FETCH = 34
MAX_CHART_MARKETS = 14
MAX_CHART_POINTS = 90
MAX_EVENTS = 150
W18 = 10 ** 18


def _curl(args):
    r = subprocess.run(["curl", "-sS", "--fail", "--max-time", "120", *args],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "").strip()[:200])
    return json.loads(r.stdout)


def post(fn, body):
    return _curl(["-X", "POST", f"{BASE}/{fn}",
                  "-H", "content-type: application/json", "-d", json.dumps(body)])


def get(fn, **qs):
    q = "&".join(f"{k}={v}" for k, v in qs.items())
    return _curl([f"{BASE}/{fn}?{q}"])


def is_zero(v):
    return not (v and set(str(v).replace("0x", "")) - {"0"})


def short(h):
    """First 10 hex chars — unique across this dataset, and 4x cheaper than a full id."""
    return str(h)[2:12] if h else None


def fnum(v, nd):
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


WRAPPED = {}   # market id -> [wrapped outcome token address, ...] for pool→outcome mapping
URL = {}       # short id -> Seer's real slug; shipped only for cited markets (links.js)
PARENT = {}    # short parent id -> (full parent id, chainId)


def market_row(m):
    q = (m.get("questions") or [{}])[0]
    full = m["id"]
    WRAPPED[full] = m.get("wrappedTokens") or []
    # Names ship whole. A row clamps them in CSS where the layout needs it; slicing
    # them here cut 116 of 284 questions mid-word, including the headline of the
    # market document — the one object the boundary claim is about.
    name = re.sub(r"\s+", " ", (m.get("marketName") or "").strip())[:200]
    outs = [re.sub(r"\s+", " ", str(o).strip())[:40] for o in (m.get("outcomes") or [])]
    row = {
        "id": short(full),
        "name": name,
        "ch": int(m.get("chainId") or 0),
        "ty": "F" if m.get("type") == "Futarchy" else "G",
        "outs": outs[:16],
        "no": len(outs) if len(outs) > 16 else None,
        "odds": ([fnum(o, 2) for o in (m.get("odds") or [])][:16] or None),
        "liq": int(round(fnum(m.get("liquidityUSD"), 0) or 0)),
        "vol": int(round(fnum(m.get("volumeUSD"), 0) or 0)),
        "cat": (m.get("categories") or [None])[0],
        "v": (m.get("verification") or {}).get("status"),
        "o": m.get("openingTs"),
        "f": m.get("finalizeTs"),
        "hl": bool(m.get("hasLiquidity")),
        "arb": int(m.get("questionsInArbitration") or 0),
        "rep": bool(m.get("payoutReported")),
        # conditional-token tree: this is what the motion contract encodes
        "pm": None if is_zero((m.get("parentMarket") or {}).get("id"))
             else short((m.get("parentMarket") or {}).get("id")),
        "po": m.get("parentOutcome"),
        "pc": None if is_zero(m.get("parentCollectionId")) else short(m.get("parentCollectionId")),
    }
    if not row["no"]:
        del row["no"]
    if q.get("is_pending_arbitration"):
        row["pa"] = 1
    if m.get("templateId") in ("7", "8", 7, 8):
        row["lo"] = m.get("lowerBound")
        row["up"] = m.get("upperBound")
    if row["pm"]:
        PARENT[row["pm"]] = ((m.get("parentMarket") or {}).get("id"),
                             int(m.get("chainId") or 100))
    if m.get("url"):
        URL[row["id"]] = m["url"]
    return row


def norm_series(mid, raw):
    """markets-charts → [{oi, t0, t1, s:[[unixSec, pricePerOutcomeToken], ...]}].

    Each entry in raw is one Swapr pool, i.e. one outcome-token pair, so a market
    carries a separate real price history per outcome. token0Price is a raw pool
    ratio, not a dollar: the direction of the pair is unknown until it is matched
    against the market's wrappedTokens, and an empty pool prints absurd ratios.
    So a series is kept only when the outcome is identified and the price sits
    inside the no-arbitrage band for a share that pays $1.
    """
    tokens = WRAPPED.get(mid) or []
    out = []
    for pool_series in raw if isinstance(raw, list) else []:
        if not isinstance(pool_series, list) or not pool_series:
            continue
        pts = []
        for row in pool_series:
            ts, p = row.get("periodStartUnix"), row.get("token0Price")
            if ts and p:
                try:
                    pts.append([int(float(ts)), round(float(p), 4)])
                except (TypeError, ValueError):
                    continue
        if not pts:
            continue
        pts.sort(key=lambda x: x[0])
        if len(pts) > MAX_CHART_POINTS:
            step = len(pts) / MAX_CHART_POINTS
            pts = [pts[int(i * step)] for i in range(MAX_CHART_POINTS)] + [pts[-1]]
        t0 = ((pool_series[0].get("pool") or {}).get("token0") or {})
        t1 = ((pool_series[0].get("pool") or {}).get("token1") or {})
        addr = t0.get("id")
        oi = tokens.index(addr) if addr in tokens else None
        if oi is None and t1.get("id") in tokens:
            oi = tokens.index(t1.get("id"))
            pts = [[t, round(1.0 / p, 5) if p else None] for t, p in pts]
            pts = [p for p in pts if p[1] is not None]
        if oi is None or not pts:
            continue
        vals = [p[1] for p in pts]
        if not all(0.0005 <= v <= 1.6 for v in vals):
            continue
        out.append({"oi": oi, "t0": str(t0.get("name") or "")[:16],
                    "t1": str(t1.get("name") or "")[:16], "s": pts})
    return out


def downsample_events(events):
    events.sort(key=lambda e: -e["t"])
    return events[:MAX_EVENTS]


def write_js(name, var, payload):
    body = f"export const {var} = {json.dumps(payload, separators=(',', ':'))};\n"
    size = len(body.encode())
    gz = len(zlib.compress(body.encode(), 9))
    flag = "  ⚠ OVER BUDGET" if size > BUDGET else ""
    print(f"  {name:16s} {size/1000:7.1f} KB  (gzip {gz/1000:.1f} KB){flag}")
    if size > BUDGET:
        if isinstance(payload, list) and payload and isinstance(payload[0], dict):
            cost = {k: len(json.dumps([r.get(k) for r in payload], separators=(',', ':')))
                    for k in payload[0]}
            top = sorted(cost.items(), key=lambda kv: -kv[1])[:6]
            print("    cost by key: " + "  ".join(f"{k}={v/1000:.1f}KB" for k, v in top))
        raise SystemExit(f"abort: {name} is {size} bytes > {BUDGET} budget — trim the projection")
    (OUT / name).write_text(body)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    t0, baked_at = time.time(), int(time.time())

    universe = post("markets-search", {"limit": 1, "page": 1}).get("count")
    print(f"markets-search · universe={universe}")
    cond = post("markets-search", {"limit": 500, "page": 1,
                                   "showConditionalMarkets": True})["markets"]
    top = post("markets-search", {"limit": 400, "page": 1, "minLiquidity": 1})["markets"]

    by_id = {}
    for m in list(top) + list(cond):
        try:
            r = market_row(m)
        except Exception:
            continue
        if r["id"]:
            by_id[r["id"]] = r
    rows = sorted(by_id.values(), key=lambda r: -r["liq"])[:MAX_MARKETS]
    print(f"  unique={len(by_id)} → shipping {len(rows)}")

    # A conditional market's parent is a real market with its own price. The fan-out
    # morph moves between them, so every parent a shipped row points at must be in the set.
    held = {r["id"] for r in rows}
    missing = [(pid, full, ch) for pid, (full, ch) in PARENT.items() if pid not in held]
    if missing:
        print(f"  closing the tree · fetching {len(missing)} parent markets")
    for pid, full, chain in missing[:MAX_PARENT_FETCH]:
        try:
            resp = post("get-market", {"chainId": chain, "id": full})
            m = resp.get("market") if isinstance(resp, dict) and resp.get("market") else resp
            if not (isinstance(m, dict) and m.get("id")):
                print(f"    parent {pid}: unexpected response {str(resp)[:70]}")
                continue
            r = market_row(m)
            by_id[r["id"]] = r
            rows.append(r)
        except Exception as e:
            print(f"    parent {pid} failed: {str(e)[:60]}")

    rows.sort(key=lambda r: -r["liq"])

    kids = {}
    for r in rows:
        if r["pm"]:
            kids.setdefault(r["pm"], []).append(r["id"])
    tree = [{"pm": p, "kids": sorted(c),
             "name": by_id[p]["name"] if p in by_id else None,
             "outs": by_id[p]["outs"] if p in by_id else [],
             "odds": by_id[p]["odds"] if p in by_id else None}
            for p, c in sorted(kids.items(), key=lambda kv: -len(kv[1]))][:40]

    cats = {}
    for r in rows:
        e = cats.setdefault(r["cat"] or "misc", {"n": 0, "liq": 0.0})
        e["n"] += 1
        e["liq"] = round(e["liq"] + r["liq"], 2)

    print("markets-charts · per-outcome price history")
    charts = {}
    for r in [x for x in rows if x["hl"]]:
        if len(charts) >= MAX_CHART_MARKETS:
            break
        full = next((k for k, v in WRAPPED.items() if short(k) == r["id"]), None)
        if not full:
            continue
        try:
            raw = get("markets-charts", ids=full).get(full)
            s = norm_series(full, raw)
            if s:
                charts[r["id"]] = s
            print(f"    {r['name'][:40]:42s} {len(s)} outcome-series ×"
                  f"{len(s[0]['s']) if s else 0} pts")
        except Exception as e:
            print(f"    chart failed {r['id']}: {str(e)[:60]}")

    print("get-pnl-leaderboard · get-transactions · real CTF events")
    people = get("get-pnl-leaderboard", limit=24, sort="pnl", dir="desc")
    prows = [{"r": p["rank"], "a": p["address"], "pnl": round(p.get("pnl") or 0, 2),
              "vol": round(p.get("volume") or 0, 2), "roi": round(p.get("roi") or 0, 4),
              "m": p.get("marketCount"), "sc": p.get("score"), "t": p.get("tier")}
             for p in (people.get("rows") or [])]

    events = []
    for p in (people.get("rows") or [])[:8]:
        try:
            tx = get("get-transactions", account=p["address"], eventType="ctf")
        except Exception as e:
            print(f"    tx failed {p['address'][:10]}: {str(e)[:60]}")
            continue
        for r in tx if isinstance(tx, list) else []:
            if r.get("type") not in ("split", "merge", "redeem"):
                continue
            amt, pay = r.get("amount"), r.get("payout")
            events.append({
                "t": int(r.get("timestamp") or 0), "k": r["type"],
                "mid": short(r.get("marketId")),
                "name": re.sub(r"\s+", " ", (r.get("marketName") or "").strip())[:64],
                "amt": round(float(amt) / W18, 2) if amt else None,
                "pay": round(float(pay) / W18, 4) if pay else None,
                "ch": r.get("chainId"), "tx": short(r.get("transactionHash")),
                "who": p["address"][:8],
            })
        if len(events) > MAX_EVENTS * 2:
            break
    events = downsample_events(events)
    kinds = {}
    for e in events:
        kinds[e["k"]] = kinds.get(e["k"], 0) + 1
    print(f"    {len(events)} events {kinds}")

    # Seer's own slugs are not reproducible from marketName (80-char cut + a "-2" dedupe
    # counter), so the outbound link is stored per market — but only for the markets this
    # entry cites as evidence, not for all 240 explorer rows (~20 KB we spend on breadth).
    cited = set(charts) | {r["id"] for r in rows[:50]} | {t["pm"] for t in tree} \
            | {k for t in tree for k in t["kids"]} | {e["mid"] for e in events}
    links = {i: URL[i] for i in cited if i in URL}
    print(f"    {len(links)} real Seer slugs → links.js")

    write_js("markets.js", "MARKETS", rows)
    write_js("tree.js", "TREE", tree)
    write_js("cats.js", "CATS", cats)
    write_js("charts.js", "CHARTS", charts)
    write_js("events.js", "EVENTS", events)
    write_js("people.js", "PEOPLE", prows)
    write_js("links.js", "LINKS", links)
    write_js("meta.js", "META", {
        "bakedAt": baked_at,
        "iso": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(baked_at)),
        "source": BASE, "universe": universe,
        "chains": sorted({r["ch"] for r in rows}),
        "counts": {"markets": len(rows), "conditional": sum(len(t["kids"]) for t in tree),
                   "trees": len(tree), "chartMarkets": len(charts),
                   "events": len(events), "eventKinds": kinds, "traders": len(prows),
                   "links": len(links)},
        "note": "Prebaked snapshot of public endpoints. ?live=1 fetches the same endpoints at runtime.",
    })
    print(f"done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
