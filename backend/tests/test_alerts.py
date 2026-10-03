from radar.alerts import AlertService
from radar.config import load_config
from radar.gates import build_entry
from radar.models import Stage
from radar.scoring import score_entry
from tests.test_gates import tok


class Stub:
    def __init__(self, cfg):
        self.cfg, self.data = cfg, {}

    def scored(self, stage):
        return [score_entry(build_entry(t, self.cfg), self.cfg, {}) for t in self.data.get(stage, [])]


def make(**cfg_over):
    cfg = load_config()
    cfg["scoring"]["ranking"]["quadrant"] = {"min_potential": 0, "max_risk": 100}   # todo token sano cuenta
    for k, v in cfg_over.items():
        cfg["alerts"][k] = v
    stub = Stub(cfg)
    return stub, AlertService(stub, cfg, clock=lambda: 100.0)


def test_first_scan_is_baseline_only():
    stub, al = make()
    stub.data[Stage.NEW] = [tok(address="A", smart_money_buyers=2, age_min=2)]
    assert al.events()["events"] == []


def test_quadrant_entry_fires_once():
    stub, al = make()
    al.events()
    stub.data[Stage.NEW] = [tok(address="A")]
    evs = al.events(after=0)["events"]
    assert [e["type"] for e in evs] == ["quadrant"] and evs[0]["address"] == "A"
    assert al.events(after=0)["events"] == evs          # no se repite


def test_smart_money_respects_configurable_age():
    stub, al = make()
    al.events()
    stub.data[Stage.NEW] = [tok(address="OLD", smart_money_buyers=2, age_min=30), tok(address="NEW", smart_money_buyers=2, age_min=3)]
    sm = [e for e in al.events(after=0)["events"] if e["type"] == "smart_money"]
    assert [e["address"] for e in sm] == ["NEW"]
    stub2, al2 = make(smart_money={"enabled": True, "max_age_min": 60, "min_buyers": 1})
    al2.events()
    stub2.data[Stage.NEW] = [tok(address="OLD", smart_money_buyers=2, age_min=30)]
    assert [e["type"] for e in al2.events(after=0)["events"] if e["type"] == "smart_money"] == ["smart_money"]


def test_rejected_tokens_never_alert():
    stub, al = make()
    al.events()
    stub.data[Stage.NEW] = [tok(address="H", is_honeypot=True, smart_money_buyers=3, age_min=1)]
    assert al.events(after=0)["events"] == []


def test_after_filters_and_disabled_flags():
    stub, al = make(quadrant_entry=False, smart_money={"enabled": False, "max_age_min": 10, "min_buyers": 1})
    al.events()
    stub.data[Stage.NEW] = [tok(address="A", smart_money_buyers=2, age_min=1)]
    assert al.events(after=0)["events"] == []
    stub, al = make()
    al.events()
    stub.data[Stage.NEW] = [tok(address="A")]
    last = al.events()["last_id"]
    assert al.events(after=last)["events"] == []


def test_config_exposes_sound():
    _, al = make()
    c = al.events()["config"]
    assert c["smart_money_max_age_min"] == 10 and len(c["sound"]["quadrant"]) == 2


def test_smart_money_message_for_brand_new_token():
    stub, al = make()
    al.events()
    stub.data[Stage.NEW] = [tok(address="A", smart_money_buyers=1, age_min=0.4)]
    msg = [e["message"] for e in al.events(after=0)["events"] if e["type"] == "smart_money"][0]
    assert "menos de 1 min" in msg and "0 min" not in msg
