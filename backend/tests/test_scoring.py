from radar.config import load_config
from radar.gates import build_entry
from radar.scoring import ramp, score_entry, trending_shares
from tests.test_gates import tok

CFG = load_config()


def sc(**kw):
    return score_entry(build_entry(tok(**kw), CFG), CFG, {})


def test_ramp():
    assert ramp(0, [0, 10]) == 0 and ramp(5, [0, 10]) == 50 and ramp(99, [0, 10]) == 100 and ramp(None, [0, 1]) is None


def test_risk_levels_and_subscores_visible():
    good = sc(top10_rate=0.15, bundler_rate=0.02, sniper_rate=0.02, liquidity=20000, market_cap=60000, holders=600, age_min=90)
    bad = sc(mint_renounced=False, freeze_renounced=False, top10_rate=0.7, bundler_rate=0.45, sniper_rate=0.4,
             dev_hold_rate=0.3, liquidity=500, holders=20, age_min=1, dev_sold=True, rug_ratio=0.45)
    assert good.risk.level == "Sólido" and bad.risk.level in ("Alto", "Extremo")
    assert set(good.risk.subscores) == {"contract", "liquidity", "holders", "dev", "age"}
    assert bad.risk.score > good.risk.score and 1 <= len(bad.risk.reasons) <= 3


def test_failed_gates_lead_reasons():
    s = sc(sell_tax_pct=40)
    assert s.risk.reasons[0].startswith("Gate sell_tax")


def test_potential_separate_from_risk_and_rewards_smart_money():
    base = sc(smart_money_buyers=0, kol_buyers=0)
    smart = sc(smart_money_buyers=5, kol_buyers=3, smart_money_first_entry_min=1)
    assert smart.potential.score > base.potential.score
    assert smart.risk.score == base.risk.score
    assert set(smart.potential.subscores) == {"velocity", "buyers", "pressure", "dev", "narrative"}


def test_dev_rugs_zero_dev_potential():
    assert sc(dev_rug_count=3).potential.subscores["dev"] == 0


def test_narrative_uses_trending():
    e = build_entry(tok(narrative_tags=["ai"]), CFG)
    hot = score_entry(e, CFG, {"ai": 0.5}); cold = score_entry(e, CFG, {})
    assert hot.potential.subscores["narrative"] == 100 and cold.potential.subscores["narrative"] == 0


def test_rejected_ranks_zero_and_never_quadrant():
    s = sc(is_honeypot=True, smart_money_buyers=5)
    assert s.adjusted == 0 and not s.quadrant


def test_adjusted_penalizes_risk():
    safe = sc(top10_rate=0.15, bundler_rate=0.02, sniper_rate=0.02)
    risky = sc(top10_rate=0.6, bundler_rate=0.4, sniper_rate=0.35, mint_renounced=False)
    assert safe.adjusted > risky.adjusted


def test_weights_from_config():
    cfg = load_config(); cfg["scoring"]["potential"]["weights"] = {"velocity": 0, "buyers": 1, "pressure": 0, "dev": 0, "narrative": 0}
    e = build_entry(tok(smart_money_buyers=5, kol_buyers=3, smart_money_first_entry_min=1), cfg)
    s = score_entry(e, cfg, {})
    assert s.potential.score == s.potential.subscores["buyers"]


def test_disclaimer_present():
    assert "no es una predicción" in sc().potential.note.lower()
