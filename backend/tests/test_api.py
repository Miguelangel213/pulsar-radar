import pathlib

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from radar.config import load_config
from services.radar_service import RadarService
from services.db import SqliteStore
from services.store import JsonStore
from services.token_scanner import TokenScanner
from tests.helpers import NOW, FakeClient, pair

CFG = load_config()


@pytest.fixture
def client(tmp_path):
    fc = FakeClient(
        pairs=[pair("GOOD", "GOOD", liq=60000, vol_h1=30000, buys_h1=300, sells_h1=100, mcap=40000, age_min=15, boosts=2),
               pair("MID", "MID", liq=9000, vol_h1=3000, buys_h1=80, sells_h1=70, mcap=150000, age_min=45),
               pair("RUG", "RUG", liq=300, age_min=10),
               pair("CURVE", "CURVE", dex="pumpfun", liq=None, mcap=12000, age_min=5),
               pair("OLD", "OLD", age_min=3000, dex="raydium")],
        boosts_latest=["GOOD", "MID", "RUG", "CURVE", "OLD"])
    sc = TokenScanner(fc, CFG, JsonStore(tmp_path, 60, 1000), clock=lambda: NOW, db=SqliteStore(tmp_path / 'radar.db', 60))
    app = create_app(RadarService(sc, CFG), client=fc)
    return TestClient(app)


def get(c, **p):
    r = c.get("/radar", params=p)
    assert r.status_code == 200, r.text
    return r.json()


def syms(d):
    return [i["entry"]["token"]["symbol"] for i in d["items"]]


def test_health_reports_dexscreener(client):
    client.get("/radar")
    h = client.get("/health").json()
    assert h["source"] == "DEXSCREENER" and h["tracked"] == 5


def test_response_contract_and_disclaimer(client):
    d = get(client, stage="new_creation")
    assert d["mode"] == "DEXSCREENER" and "recomendación" in d["disclaimer"] and "contrato" in d["meta"]["coverage"]
    it = d["items"][0]
    assert {"entry", "risk", "potential", "adjusted", "quadrant"} <= set(it)
    assert it["entry"]["token"]["url"].startswith("https://dexscreener.com/")


def test_stage_membership_and_default_hides_rejected(client):
    assert set(syms(get(client, stage="new_creation"))) == {"GOOD", "MID", "CURVE"}      # RUG descartado
    assert "RUG" in syms(get(client, stage="new_creation", include_rejected=True))
    assert syms(get(client, stage="trending"))[0] == "GOOD"
    assert "OLD" not in syms(get(client, stage="graduated"))                             # fuera de ventana


def test_sorted_best_first_and_rejected_last(client):
    d = get(client, stage="new_creation", include_rejected=True)
    assert syms(d)[0] == "GOOD" and syms(d)[-1] == "RUG"
    adj = [i["adjusted"] for i in d["items"]]
    assert adj == sorted(adj, reverse=True)


def test_filters(client):
    assert set(syms(get(client, stage="new_creation", min_liquidity=20000))) == {"GOOD", "CURVE"}   # liquidez desconocida no se descarta
    assert syms(get(client, stage="new_creation", max_age=10)) == ["CURVE"]
    assert set(syms(get(client, stage="new_creation", min_mcap=100000))) == {"MID"}
    assert all(i["risk"]["level"] == "Sólido" for i in get(client, stage="new_creation", risk_level="Sólido")["items"])


def test_sort_options(client):
    assert syms(get(client, stage="new_creation", sort="market_cap", order="asc"))[0] == "CURVE"
    assert syms(get(client, stage="new_creation", sort="age"))[0] == "CURVE"


def test_invalid_params(client):
    for p in ({"sort": "nope"}, {"risk_level": "x"}, {"stage": "x"}):
        assert client.get("/radar", params=p).status_code == 422


def test_pairs_and_search_endpoints(client):
    assert client.get("/pairs/GOOD").json()["pairs"][0]["baseToken"]["address"] == "GOOD"
    s = client.get("/search", params={"q": "good"}).json()
    assert s["count"] == 5 and s["items"][0]["adjusted"] >= s["items"][-1]["adjusted"]


def test_alerts_endpoint(client):
    d = client.get("/alerts").json()
    assert {"events", "last_id", "config"} <= set(d)


def test_no_gmgn_dependencies_left():
    root = pathlib.Path(__file__).resolve().parent.parent
    for f in list(root.rglob("*.py")) + list(root.rglob("*.yaml")) + [root / "requirements.txt"]:
        if f.name == "test_api.py" or "__pycache__" in f.parts:
            continue
        assert "gmgn" not in f.read_text(encoding="utf-8").lower(), f


def test_token_links_in_radar_response(client):
    t = get(client, stage="new_creation")["items"][0]["entry"]["token"]
    assert t["links"]["solscan"].endswith("/token/" + t["address"]) and t["pair_address"] in t["links"]["dexscreener"]


def test_stored_token_and_history_endpoints(client):
    client.get("/radar")
    r = client.get("/tokens/GOOD").json()
    assert r["symbol"] == "GOOD" and r["pair_address"] == "pairGOOD" and r["potential"] > 0
    h = client.get("/tokens/GOOD/history").json()
    assert h["rows"] and h["rows"][0]["token_address"] == "GOOD"
    assert client.get("/tokens/NOPE").status_code == 404
    assert client.get("/health").json()["db"]["tokens"] == 5
