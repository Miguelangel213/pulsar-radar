from radar.config import load_config
from radar.gates import build_entry
from radar.models import Stage, Token

CFG = load_config()


def tok(**kw) -> Token:
    base = dict(address="a", symbol="T", name="T", stage=Stage.NEW, age_min=5, price=1, market_cap=10000,
                liquidity=3000, volume=5000, holders=100, curve_progress=0.3,
                is_honeypot=False, buy_tax_pct=0, sell_tax_pct=0, mint_renounced=True, freeze_renounced=True,
                rug_ratio=0.05, bundler_rate=0.05, sniper_rate=0.05, top10_rate=0.2,
                dev_hold_rate=0.02, dev_rug_count=0)
    base.update(kw)
    return Token(**base)


def test_clean_token():
    e = build_entry(tok(), CFG)
    assert e.verdict == "clean" and e.failed == []


def test_honeypot_rejects():
    e = build_entry(tok(is_honeypot=True), CFG)
    assert e.verdict == "rejected" and "honeypot" in e.failed


def test_sell_tax_rejects():
    assert build_entry(tok(sell_tax_pct=30), CFG).verdict == "rejected"


def test_unrenounced_mint_is_red_flag_not_reject():
    e = build_entry(tok(mint_renounced=False), CFG)
    assert e.verdict == "red_flags" and e.failed == ["mint_authority"]


def test_dev_rug_history_rejects():
    assert build_entry(tok(dev_rug_count=3), CFG).verdict == "rejected"


def test_missing_data_is_unknown_not_fail():
    e = build_entry(tok(top10_rate=None), CFG)
    assert e.verdict == "clean"
    assert next(g for g in e.gates if g.name == "top10_concentration").status == "unknown"


def test_thresholds_come_from_config():
    cfg = load_config()
    cfg["gates"]["snipers"]["max_rate"] = 0.01
    assert "snipers" in build_entry(tok(sniper_rate=0.05), cfg).failed
