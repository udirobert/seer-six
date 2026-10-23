#!/usr/bin/env python3
"""Bake the Futarchy evidence: what the type actually contains today.

The surface built on this data refuses to invent a price, so the honest artefact
is the API's own shape. This fetches every Futarchy row in one call, aggregates
the fields a priced conditional pair would need, and ships the aggregate plus a
sample of real (non-test) proposals with their slugs, so each row on the page
can be opened on Seer. Byte budget is deliberately tiny — the point is a
negative result, not a dataset.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bake  # noqa: E402

SEP = "␟"  # ␟ — reality.eth splits a question from its answers and domain with this


def decode(m):
    raw = " ".join(str(x) for x in (m.get("encodedQuestions") or []))
    parts = [p for p in re.split(r"[\u241f\u241e]", raw) if p.strip()]
    return parts[:4]


def main():
    allm, page = [], 1
    while True:
        chunk = bake.post("markets-search", {"limit": 500, "page": page,
                                             "type": "Futarchy"})["markets"]
        allm += chunk
        if len(chunk) < 500 or page > 4:
            break
        page += 1

    def agg(pred):
        return sum(1 for m in allm if pred(m))

    names = sorted({str(m.get("marketName", ""))[:34] for m in allm})
    real = [m for m in allm
            if not re.match(r"^\s*(test|futarchy proposal|f)\b", str(m.get("marketName", "")), re.I)]
    sample = sorted(real, key=lambda m: -int(m.get("blockTimestamp") or 0))[:12]

    rows = [{
        "id": bake.short(m.get("id")),
        "nm": str(m.get("marketName") or "")[:96],
        "slug": str(m.get("url") or "")[:96],
        "ch": m.get("chainId"),
        "out": [str(o)[:12] for o in (m.get("outcomes") or [])][:4],
        "c1": bake.short(m.get("collateralToken1")),
        "c2": bake.short(m.get("collateralToken2")),
        "od": m.get("odds"),
        "liq": bake.fnum(m.get("liquidityUSD"), 0),
        "vol": bake.fnum(m.get("volumeUSD"), 0),
        "hl": bool(m.get("hasLiquidity")),
        "pb": m.get("poolBalance"),
        "sup": 1 if int(m.get("outcomesSupply") or 0) > 0 else 0,
        "par": "zero" if bake.is_zero((m.get("parentMarket") or {}).get("id")) else "set",
        "pcol": "zero" if bake.is_zero(m.get("parentCollectionId")) else "set",
        "col": "zero" if bake.is_zero(m.get("collateralToken")) else "set",
        "v": (m.get("verification") or {}).get("status"),
        "ar": bake.short((m.get("questions") or [{}])[0].get("arbitrator")),
        "to": (m.get("questions") or [{}])[0].get("timeout"),
        "o": m.get("openingTs"),
        "f": m.get("finalizeTs"),
        "t": m.get("blockTimestamp"),
        "q": decode(m),
    } for m in sample]

    payload = {
        "count": len(allm),
        "fields": {
            "priced": agg(lambda m: any(v is not None for v in (m.get("odds") or []))),
            "withLiquidity": agg(lambda m: bool(m.get("hasLiquidity"))),
            "liquidityUSD": round(sum(float(m.get("liquidityUSD") or 0) for m in allm)),
            "volumeUSD": round(sum(float(m.get("volumeUSD") or 0) for m in allm)),
            "withSupply": agg(lambda m: int(m.get("outcomesSupply") or 0) > 0),
            "reported": agg(lambda m: bool(m.get("payoutReported"))),
            "nonzeroParentMarket": agg(lambda m: not bake.is_zero((m.get("parentMarket") or {}).get("id"))),
            "nonzeroParentCollection": agg(lambda m: not bake.is_zero(m.get("parentCollectionId"))),
            "nonzeroCollateral": agg(lambda m: not bake.is_zero(m.get("collateralToken"))),
            "twoCollaterals": agg(lambda m: not bake.is_zero(m.get("collateralToken1"))
                                  and not bake.is_zero(m.get("collateralToken2"))),
            "verified": agg(lambda m: (m.get("verification") or {}).get("status") == "verified"),
            "testNamed": sum(1 for m in allm
                             if re.match(r"^\s*test", str(m.get("marketName", "")), re.I)),
            "distinctNames": len(names),
            "chains": sorted({m.get("chainId") for m in allm}),
        },
        "sample": rows,
    }
    bake.OUT.mkdir(parents=True, exist_ok=True)
    bake.write_js("futarchy.js", "FUT", payload)
    print(f"futarchy rows={len(allm)} real={len(real)} fields={payload['fields']}")


if __name__ == "__main__":
    main()
