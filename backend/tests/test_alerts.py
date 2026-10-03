from radar.models import Stage
from services.alerts import AlertService
from radar.config import load_config
from scoring.gates import build_entry
from scoring.scoring_engine import score_entry
from services.token_scanner import classify, normalize_pair
from tests.helpers import NOW, pair

CFG = load_config()


class Stub:
    def __init__(self):
        self.pairs = []
    def scored(self, stage):
        out = []
        for p in self.pairs:
            t = normalize_pair(p, NOW * 1000); t.stages = classify(t, CFG)
            s = score_entry(build_entry(t, CFG), CFG)
            if stage.value in t.stages:
                out.append(s)
        return out


STRONG = dict(liq=60000, vol_h1=30000, buys_h1=300, sells_h1=100, mcap=40000, age_min=15)


def make():
    stub = Stub()
    return stub, AlertService(stub, CFG, clock=lambda: 100.0)


def test_first_scan_is_baseline_only():
    stub, al = make()
    stub.pairs = [pair("A", **STRONG)]
    assert al.events()["events"] == []


def test_quadrant_entry_fires_once():
    stub, al = make()
    al.events()
    stub.pairs = [pair("A", **STRONG)]
    evs = al.events(after=0)["events"]
    assert [e["type"] for e in evs] == ["quadrant"] and evs[0]["address"] == "A" and "alto potencial" in evs[0]["message"]
    assert al.events(after=0)["events"] == evs


def test_weak_and_rejected_tokens_never_alert():
    stub, al = make()
    al.events()
    stub.pairs = [pair("W", liq=5000, vol_h1=100, buys_h1=20, sells_h1=40, mcap=900000, age_min=100), pair("R", **dict(STRONG, liq=100))]
    assert al.events(after=0)["events"] == []


def test_after_filters_and_sound_config_exposed():
    stub, al = make()
    al.events()
    stub.pairs = [pair("A", **STRONG)]
    d = al.events()
    assert al.events(after=d["last_id"])["events"] == [] and len(d["config"]["sound"]["quadrant"]) == 2
