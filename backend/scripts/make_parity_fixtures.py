"""Genera frontend/tests/fixtures/parity.json: casos de entrada y el resultado ESPERADO calculado por el motor Python.
El test del motor TypeScript (frontend/tests/engine.parity.test.ts) debe reproducirlos exactamente.

Uso:  python3 scripts/make_parity_fixtures.py [--live]      (--live vuelve a capturar datos reales de DexScreener)
"""
from __future__ import annotations

import copy
import json
import random
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from clients.dexscreener_client import DexScreenerClient      # noqa: E402
from radar.config import load_config                          # noqa: E402
from scoring.gates import build_entry                         # noqa: E402
from scoring.scoring_engine import score_entry                # noqa: E402
from services.alerts import AlertService                      # noqa: E402
from services.radar_service import SORT_KEYS, RadarService    # noqa: E402
from services.store import JsonStore                          # noqa: E402
from services.token_scanner import TokenScanner, classify, normalize_pair   # noqa: E402
from tests.helpers import NOW, FakeClient, pair               # noqa: E402

OUT = ROOT.parent / "frontend" / "tests" / "fixtures" / "parity.json"
LIVE = OUT.parent / "live.json"
CFG = load_config()


def dump(o):
    return o.model_dump(mode="json")


def synthetic_pairs():
    r = random.Random(7)
    pairs = []
    # valores límite deliberados
    for liq in (None, 0.0, 500.0, 1499.0, 1500.0, 3000.0, 60000.0):
        pairs.append(pair(f"L{liq}", liq=liq, dex="pumpfun" if liq is None else "pumpswap"))
    for age in (0.2, 29.9, 30.0, 100.0, 1439.0, 1441.0, 5000.0):
        pairs.append(pair(f"A{age}", age_min=age))
    for b, s in ((0, 0), (3, 0), (5, 5), (4, 5), (300, 100), (20, 45), (20, 40), (10, 10), (1, 9), (50, 0)):
        pairs.append(pair(f"B{b}_{s}", buys_h1=b, sells_h1=s, buys_m5=b // 5, sells_m5=s // 5))
    for chg in (None, -60.0, -60.1, -59.9, -80.0, 0.0, 300.0):
        p = pair(f"C{chg}", chg_h1=chg if chg is not None else 0.0)
        if chg is None:
            p["priceChange"]["h1"] = None
        pairs.append(p)
    for mc in (None, 0, 1, 9999.0, 10000.0, 45000.0, 3_000_000.0, 9e9):
        p = pair(f"M{mc}", mcap=mc if mc else 1.0)
        p["marketCap"] = mc
        if mc is None:
            p["fdv"] = None
        pairs.append(p)
    p = pair("NOINFO"); del p["info"]; del p["boosts"]; pairs.append(p)
    p = pair("NOTX"); del p["txns"]; del p["volume"]; del p["priceChange"]; pairs.append(p)
    p = pair("NOCREATED"); del p["pairCreatedAt"]; pairs.append(p)
    p = pair("STR"); p["priceUsd"] = "1.5e-7"; p["marketCap"] = "123456.7"; pairs.append(p)
    pairs.append(pair("BOOST", boosts=7)); pairs.append(pair("PF", dex="pumpfun", liq=None, mcap=45000.0, age_min=500))
    pairs.append(pair("OTHERCHAIN", chain="ethereum"))
    # aleatorios (cubren empates de redondeo y combinaciones raras)
    for i in range(150):
        pairs.append(pair(
            f"R{i}", symbol=f"R{i}", dex=r.choice(["pumpswap", "pumpfun", "raydium", "meteoradbc"]), age_min=r.choice([r.uniform(0, 60), r.uniform(0, 3000)]),
            liq=r.choice([None, r.uniform(0, 100000)]), mcap=r.uniform(1000, 5e6), vol_h1=r.uniform(0, 1e6),
            buys_h1=r.randint(0, 600), sells_h1=r.randint(0, 600), buys_m5=r.randint(0, 40), sells_m5=r.randint(0, 40),
            chg_h1=r.uniform(-90, 400), boosts=r.choice([0, 0, 0, r.randint(1, 100)])))
    return pairs


def entry_expected(p):
    t = normalize_pair(p, NOW * 1000, CFG["links"])
    t.sources = ["profile"] if p["baseToken"]["address"].startswith("R") else []
    t.stages = classify(t, CFG)
    s = score_entry(build_entry(t, CFG), CFG)
    return {"sources": t.sources, "expected": dump(s)}


def make_cases():
    out = []
    for p in synthetic_pairs():
        if p["chainId"] != "solana":
            out.append({"pair": p, "token_only": dump(normalize_pair(p, NOW * 1000, CFG["links"]))})
            continue
        e = entry_expected(p)
        out.append({"pair": p, **e})
    return out


class Replay:
    """Cliente que reproduce una grabación (feeds y pares) de forma determinista."""
    chain = "solana"

    def __init__(self, rec):
        self.rec = rec

    def boosts_latest(self): return copy.deepcopy(self.rec["boosts_latest"])
    def boosts_top(self): return copy.deepcopy(self.rec["boosts_top"])
    def profiles_latest(self): return copy.deepcopy(self.rec["profiles"])
    def search(self, q): return []
    def token_info(self, addrs): return copy.deepcopy([p for p in self.rec["pairs"] if p["baseToken"]["address"] in addrs])


class Recorder:
    chain = "solana"

    def __init__(self, real):
        self.real, self.rec = real, {"boosts_latest": [], "boosts_top": [], "profiles": [], "pairs": []}

    def boosts_latest(self): self.rec["boosts_latest"] = self.real.boosts_latest(); return self.rec["boosts_latest"]
    def boosts_top(self): self.rec["boosts_top"] = self.real.boosts_top(); return self.rec["boosts_top"]
    def profiles_latest(self): self.rec["profiles"] = self.real.profiles_latest(); return self.rec["profiles"]
    def search(self, q): return []
    def token_info(self, addrs):
        got = self.real.token_info(addrs); self.rec["pairs"] += got; return got


def record_live():
    rec = Recorder(DexScreenerClient(CFG))
    now = time.time()
    with tempfile.TemporaryDirectory() as d:
        TokenScanner(rec, CFG, JsonStore(Path(d), 60, 100), lambda: now).scan(force=True)
    LIVE.write_text(json.dumps({"captured_at": now, **rec.rec}, ensure_ascii=False, separators=(",", ":")))
    print("captura real guardada:", LIVE, len(rec.rec["pairs"]), "pares")


def make_live():
    rec = json.loads(LIVE.read_text())
    with tempfile.TemporaryDirectory() as d:
        sc = TokenScanner(Replay(rec), CFG, JsonStore(Path(d), 60, 100), lambda: rec["captured_at"])
        sc.scan(force=True)
        svc = RadarService(sc, CFG)
        stages = {}
        for st in ("new_creation", "near_graduation", "graduated", "trending"):
            from radar.models import Stage
            stages[st] = [dump(i) for i in svc.query(Stage(st), include_rejected=True)]
        tracked = sorted(sc.tracked)
        variants = []
        from radar.models import Stage
        for st in ("new_creation", "graduated", "trending"):
            for sort in SORT_KEYS:
                for order in (None, "asc", "desc"):
                    variants.append({"q": {"stage": st, "sort": sort, "order": order, "includeRejected": True},
                                     "addresses": [i.entry.token.address for i in svc.query(Stage(st), sort=sort, order=order, include_rejected=True)]})
            for kw, js in ((dict(risk_level="Moderado"), {"riskLevel": "Moderado"}), (dict(max_age=60), {"maxAge": 60}),
                           (dict(min_liquidity=5000), {"minLiquidity": 5000}), (dict(min_mcap=20000, max_mcap=200000), {"minMcap": 20000, "maxMcap": 200000}),
                           (dict(include_rejected=False), {"includeRejected": False})):
                q = {"stage": st, "sort": "adjusted", **{"includeRejected": False, **js}}
                variants.append({"q": q, "addresses": [i.entry.token.address for i in svc.query(Stage(st), **{**{"sort": "adjusted"}, **kw})]})
    return {"captured_at": rec["captured_at"], "tracked": tracked, "stages": stages, "variants": variants}


def make_alerts():
    strong = dict(liq=60000, vol_h1=30000, buys_h1=300, sells_h1=100, mcap=40000, age_min=15)
    weak = dict(liq=5000, vol_h1=100, buys_h1=20, sells_h1=40, mcap=900000, age_min=100)
    steps_in = [
        {"pairs": [pair("W1", **weak)], "t": 0},
        {"pairs": [pair("W1", **weak), pair("S1", **strong)], "t": 20},
        {"pairs": [pair("W1", **weak), pair("S1", **strong)], "t": 40},
        {"pairs": [pair("W1", **weak), pair("S1", **dict(strong, liq=300)), pair("S2", **strong)], "t": 60},
        {"pairs": [pair("W1", **weak), pair("S1", **strong), pair("S2", **strong), pair("S3", **dict(strong, boosts=3))], "t": 80},
    ]
    clk = {"t": NOW}
    fc = FakeClient()
    with tempfile.TemporaryDirectory() as d:
        sc = TokenScanner(fc, CFG, JsonStore(Path(d), 60, 100), lambda: clk["t"])
        al = AlertService(RadarService(sc, CFG), CFG, clock=lambda: 100.0)
        steps = []
        last = None
        for s in steps_in:
            clk["t"] = NOW + s["t"]
            fc.pairs = copy.deepcopy(s["pairs"]); fc._bl = [p["baseToken"]["address"] for p in s["pairs"]]
            res = al.events(after=last)
            last = res["last_id"]
            steps.append({"t": s["t"], "pairs": s["pairs"], "after_in": None if len(steps) == 0 else steps[-1]["last_id"], "expected": res, "last_id": res["last_id"]})
    return {"base": NOW, "steps": steps}


def main():
    if "--live" in sys.argv or not LIVE.exists():
        record_live()
    data = {"config": CFG, "now": NOW, "cases": make_cases(), "live": make_live(), "alerts": make_alerts()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print("fixtures:", OUT, f"{OUT.stat().st_size/1024:.0f} KB", len(data["cases"]), "casos")


if __name__ == "__main__":
    main()
