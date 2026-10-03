import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from radar.adapters.mock import MockAdapter
from radar.cache import TTLCache
from radar.config import load_config
from radar.ingest import IngestService
from radar.service import RadarService

CFG = load_config()
NOW = 1_000_000.0


@pytest.fixture
def client():
    clock = lambda: NOW
    svc = RadarService(IngestService(MockAdapter(CFG, clock), CFG, TTLCache(clock), clock), CFG)
    return TestClient(create_app(svc))


def get(client, **p):
    r = client.get("/radar", params=p)
    assert r.status_code == 200, r.text
    return r.json()


def test_health_reports_mock(client):
    assert client.get("/health").json() == {"ok": True, "mode": "MOCK"}


def test_radar_default_and_disclaimer(client):
    d = get(client, stage="graduated")
    assert d["mode"] == "MOCK" and d["count"] > 0 and "recomendación" in d["disclaimer"]
    assert all(i["entry"]["verdict"] != "rejected" for i in d["items"])


def test_sorted_by_adjusted_desc(client):
    v = [i["adjusted"] for i in get(client, stage="graduated")["items"]]
    assert v == sorted(v, reverse=True)


def test_sort_risk_asc_default(client):
    v = [i["risk"]["score"] for i in get(client, stage="graduated", sort="risk")["items"]]
    assert v == sorted(v)


def test_filters(client):
    d = get(client, stage="graduated", min_liquidity=5000, max_age=200)
    assert all(i["entry"]["token"]["liquidity"] >= 5000 and i["entry"]["token"]["age_min"] <= 200 for i in d["items"])
    lv = get(client, stage="graduated", risk_level="Sólido")
    assert all(i["risk"]["level"] == "Sólido" for i in lv["items"])
    m = get(client, stage="graduated", min_mcap=30000, max_mcap=60000)
    assert all(30000 <= i["entry"]["token"]["market_cap"] <= 60000 for i in m["items"])


def test_include_rejected_puts_them_last(client):
    items = get(client, stage="graduated", include_rejected=True)["items"]
    flags = [i["entry"]["verdict"] == "rejected" for i in items]
    assert any(flags) and flags == sorted(flags)


def test_invalid_params(client):
    assert client.get("/radar", params={"sort": "nope"}).status_code == 422
    assert client.get("/radar", params={"risk_level": "x"}).status_code == 422
    assert client.get("/radar", params={"stage": "x"}).status_code == 422


def test_meta_exposes_quadrant_and_link_template(client):
    m = get(client, stage="graduated")["meta"]
    assert m["quadrant"] == {"min_potential": 60, "max_risk": 35}
    assert "{address}" in m["gmgn_token_url"]


def test_alerts_endpoint(client):
    d = client.get("/alerts").json()
    assert {"events", "last_id", "config"} <= set(d)
    assert client.get("/alerts", params={"after": d["last_id"]}).json()["events"] == []
