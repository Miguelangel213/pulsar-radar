from radar.config import load_config
from scoring.gates import build_entry
from scoring.scoring_engine import ramp, score_entry
from services.token_scanner import normalize_pair
from tests.helpers import NOW, pair

CFG = load_config()


def sc(**kw):
    t = normalize_pair(pair(**kw), NOW * 1000)
    return score_entry(build_entry(t, CFG), CFG)


def test_ramp():
    assert ramp(0, [0, 10]) == 0 and ramp(5, [0, 10]) == 50 and ramp(99, [0, 10]) == 100 and ramp(None, [0, 1]) is None


def test_potential_uses_the_five_requested_signals():
    assert set(sc().potential.subscores) == {"liquidity", "volume", "market_cap", "age", "buy_sell"}


def test_more_liquidity_volume_buys_means_more_potential():
    weak = sc(liq=3000, vol_h1=300, buys_h1=30, sells_h1=45, buys_m5=3, sells_m5=6, mcap=900_000, age_min=900)
    strong = sc(liq=60000, vol_h1=30000, buys_h1=300, sells_h1=100, mcap=40000, age_min=15)
    assert strong.potential.score > weak.potential.score + 30


def test_small_cap_and_young_pair_have_more_room():
    assert sc(mcap=20_000).potential.subscores["market_cap"] > sc(mcap=3_000_000).potential.subscores["market_cap"]
    assert sc(age_min=10).potential.subscores["age"] > sc(age_min=1000).potential.subscores["age"]


def test_risk_rises_with_low_liquidity_sell_pressure_and_dump():
    safe = sc(liq=60000, mcap=100000, age_min=400, buys_h1=200, sells_h1=100, chg_h1=5)
    bad = sc(liq=3500, mcap=400000, age_min=3, buys_h1=60, sells_h1=140, buys_m5=2, sells_m5=9, chg_h1=-45)
    assert bad.risk.score > safe.risk.score + 25 and bad.risk.level in ("Alto", "Extremo")
    assert set(safe.risk.subscores) == {"liquidity", "age", "sell_pressure", "drop", "contract"}


def test_contract_security_is_always_reported_as_unavailable():
    r = sc().risk
    assert "contract" in r.unavailable and r.subscores["contract"] == CFG["scoring"]["risk"]["contract_unavailable"]


def test_unknown_liquidity_uses_neutral_and_is_flagged():
    s = sc(dex="pumpfun", liq=None)
    assert "liquidity" in s.potential.unavailable and s.potential.subscores["liquidity"] == 50
    assert "liquidity" in s.risk.unavailable


def test_tiny_sample_does_not_fake_buy_sell_signal():
    s = sc(buys_h1=3, sells_h1=0, buys_m5=1, sells_m5=0)
    assert "buy_sell" in s.potential.unavailable


def test_gate_reject_zeroes_ranking_and_blocks_quadrant():
    s = sc(liq=500)
    assert s.entry.verdict == "rejected" and s.adjusted == 0 and not s.quadrant
    assert s.risk.reasons[0].startswith("Gate min_liquidity")


def test_red_flags_do_not_reject():
    s = sc(chg_h1=-80)
    assert s.entry.verdict == "red_flags" and "dump_h1" in s.entry.failed and s.adjusted > 0


def test_adjusted_penalizes_risk():
    a, b = sc(liq=60000, mcap=100000, age_min=400), sc(liq=3500, mcap=400000, age_min=3, buys_h1=60, sells_h1=140, chg_h1=-45)
    assert a.adjusted > b.adjusted


def test_weights_and_thresholds_come_from_config():
    import copy
    cfg = copy.deepcopy(CFG)
    cfg["scoring"]["potential"]["weights"] = {"liquidity": 1, "volume": 0, "market_cap": 0, "age": 0, "buy_sell": 0}
    s = score_entry(build_entry(normalize_pair(pair(), NOW * 1000), cfg), cfg)
    assert s.potential.score == s.potential.subscores["liquidity"]
    cfg["gates"]["min_liquidity"]["min_usd"] = 99999
    assert build_entry(normalize_pair(pair(liq=30000), NOW * 1000), cfg).verdict == "rejected"


def test_disclaimer_mentions_no_prediction_and_missing_data():
    n = sc().potential.note.lower()
    assert "no es una predicción" in n and "smart money" in n
