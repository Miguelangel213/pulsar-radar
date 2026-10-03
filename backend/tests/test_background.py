import copy
import time

from fastapi.testclient import TestClient

from api.main import create_app
from radar.config import load_config
from services.background import BackgroundScanner
from services.db import SqliteStore
from services.radar_service import RadarService
from services.store import JsonStore
from services.token_scanner import TokenScanner
from tests.helpers import NOW, FakeClient, pair


def wait_for(cond, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_runs_repeatedly_without_any_request_and_stops():
    n = {"c": 0}
    bg = BackgroundScanner(lambda: n.__setitem__("c", n["c"] + 1), 0.02)
    bg.start()
    assert wait_for(lambda: n["c"] >= 3)
    bg.stop()
    done = n["c"]
    time.sleep(0.1)
    assert n["c"] == done and not bg.status()["running"]


def test_survives_errors_in_tick():
    n = {"c": 0}
    def tick():
        n["c"] += 1
        if n["c"] == 1:
            raise RuntimeError("red caída")
    bg = BackgroundScanner(tick, 0.02)
    bg.start()
    assert wait_for(lambda: n["c"] >= 3)
    bg.stop()
    assert bg.status()["ticks"] >= 3 and bg.last_error is None      # se recuperó


def test_app_saves_history_in_background_with_zero_requests(tmp_path):
    cfg = copy.deepcopy(load_config())
    cfg["scanner"]["scan_interval_s"] = 0.05
    cfg["scanner"]["history_interval_s"] = 0.0
    fc = FakeClient(pairs=[pair("A"), pair("B")], boosts_latest=["A", "B"])
    db = SqliteStore(tmp_path / "radar.db", 0.0)
    sc = TokenScanner(fc, cfg, JsonStore(tmp_path, 0.0, 1000), clock=time.time, db=db)
    app = create_app(RadarService(sc, cfg), client=fc)
    with TestClient(app) as c:                       # arranca el lifespan = hilo de fondo; NO se llama a /radar
        assert wait_for(lambda: db.counts()["history"] >= 4)
        h = c.get("/health").json()
    assert h["background"]["ticks"] >= 2 and h["background"]["running"] and db.counts()["tokens"] == 2


def test_background_can_be_disabled(tmp_path):
    cfg = copy.deepcopy(load_config())
    cfg["scanner"]["background"] = False
    fc = FakeClient(pairs=[pair("A")], boosts_latest=["A"])
    sc = TokenScanner(fc, cfg, JsonStore(tmp_path, 60, 100), clock=lambda: NOW)
    with TestClient(create_app(RadarService(sc, cfg), client=fc)) as c:
        time.sleep(0.2)
        assert c.get("/health").json()["background"]["running"] is False and fc.calls == 0
