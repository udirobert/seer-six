#!/usr/bin/env python3
"""Refill the one field the 11:51 UTC bake clipped too short.

market_row() sliced every name to 96 characters, which cut 116 of the 284
shipped names mid-word — including the headline of the market document the
whole entry is about ("…Bureau (CFPB) in 2"). This re-reads the book and writes
back only the `name` field, so every other byte of that bake stays what it was:
same ids, same order, same odds, same liquidity. The reel, the preview frame and
every count cited in SUBMISSION.md keep pointing at the same markets.

dev/bake.py no longer slices, so a fresh bake does not need this script; it
exists so that this fix did not require re-baking the world.
"""
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bake  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "data" / "markets.js"
CAP = 200     # bound the worst case; nothing in this dataset reaches it
OLD_CAP = 96  # what market_row() sliced at when this bake was made


def main():
    text = SRC.read_text()
    rows = json.loads(re.search(r"=\s*(\[.*\]);\s*$", text, re.S).group(1))
    want = {r["id"] for r in rows}
    print(f"{len(rows)} rows · {len(want)} ids to resolve")

    t0 = time.time()
    found = {}

    def absorb(body):
        block = bake.post("markets-search", body)
        for m in block.get("markets") or []:
            sid = bake.short(m.get("id"))
            if sid in want and sid not in found:
                found[sid] = re.sub(r"\s+", " ", (m.get("marketName") or "").strip())[:CAP]
        return block

    # The three calls the bake itself made, in the same order, cover everything it
    # took from the listings; the parents it fetched one by one are not in any
    # listing page, so those come back by name below.
    absorb({"limit": 500, "page": 1, "minLiquidity": 1})
    for page in (1, 2, 3):
        absorb({"limit": 500, "page": page, "showConditionalMarkets": True})
    print(f"  listings: {len(found)}/{len(want)} resolved")

    by_name = 0
    for r in rows:
        if r["id"] in found or len(r["name"]) < OLD_CAP:
            continue  # shorter than the old slice — the name is already whole
        for frag in (60, 40, 28):
            absorb({"marketName": r["name"][:frag], "limit": 40})
            if r["id"] in found:
                by_name += 1
                break
    print(f"  by name: +{by_name}")

    still_cut = [r for r in rows if r["id"] not in found and len(r["name"]) >= OLD_CAP]
    if still_cut:
        print(f"  ⚠ {len(still_cut)} clipped names could not be resolved: "
              f"{[r['id'] for r in still_cut][:5]}")

    changed = 0
    grew = 0
    for r in rows:
        fresh = found.get(r["id"])
        if fresh and fresh != r["name"]:
            grew += len(fresh) - len(r["name"])
            r["name"] = fresh
            changed += 1
    print(f"{changed} names refilled · {grew:+} characters")

    names = {r["id"]: r["name"] for r in rows}
    tree_src = (HERE / "data" / "tree.js").read_text()
    tree = json.loads(re.search(r"=\s*(\[.*\]);\s*$", tree_src, re.S).group(1))
    tchanged = 0
    for node in tree:
        fresh = names.get(node.get("pm"))
        if fresh and fresh != node.get("name"):
            node["name"] = fresh
            tchanged += 1
    print(f"{tchanged} of {len(tree)} tree parents renamed")

    body = f"export const MARKETS = {json.dumps(rows, separators=(',', ':'))};\n"
    tbody = f"export const TREE = {json.dumps(tree, separators=(',', ':'))};\n"
    size = len(body.encode())
    print(f"markets.js {size/1000:.1f} KB (budget {bake.BUDGET/1000:.0f} KB)")
    if size > bake.BUDGET:
        raise SystemExit(f"abort: {size} bytes over the {bake.BUDGET} budget")
    if "--write" not in sys.argv:
        print("dry run — pass --write to replace the files")
        return
    SRC.write_text(body)
    (HERE / "data" / "tree.js").write_text(tbody)
    print(f"written in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
