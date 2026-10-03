import pytest

from radar.adapters.mock import MockAdapter
from radar.cache import RateLimitError, TTLCache, with_backoff
from radar.config import load_config
from radar.ingest import IngestService
from radar.models import Stage

CFG = load_config()
NOW = 1_000_000.0


def svc(clock=lambda: NOW, adapter=None):
    return IngestService(adapter or MockAdapter(CFG, clock), CFG, TTLCache(clock), clock, lambda s: None)


def test_every_stage_has_tokens_and_respects_definition():
    s = svc()
    all_ = s.fetch_all()
    assert all(all_[k] for k in all_), {k: len(v) for k, v in all_.items()}
    assert all(e.token.age_min <= CFG["stages"]["new_creation"]["max_age_min"] and e.token.curve_progress < 0.8 for e in all_["new_creation"])
    assert all(e.token.curve_progress >= 0.8 for e in all_["near_graduation"])
    assert all(e.token.curve_progress == 1 for e in all_["graduated"])


def test_mock_is_deterministic_and_marks_mode():
    a, b = MockAdapter(CFG, lambda: NOW), MockAdapter(CFG, lambda: NOW)
    assert a.mode == "MOCK"
    assert [t.address for t in a.fetch(Stage.NEW)] == [t.address for t in b.fetch(Stage.NEW)]


def test_mock_contains_rejected_and_clean_tokens():
    v = {e.verdict for es in svc().fetch_all().values() for e in es}
    assert {"rejected", "clean"} <= v


def test_cache_avoids_second_adapter_call():
    calls = []
    inner = MockAdapter(CFG, lambda: NOW)

    class Spy:
        mode = "MOCK"
        def fetch(self, stage):
            calls.append(stage); return inner.fetch(stage)

    s = svc(adapter=Spy())
    s.fetch_stage(Stage.NEW); s.fetch_stage(Stage.NEW)
    assert len(calls) == 1


def test_backoff_retries_then_succeeds():
    n = {"c": 0}; waits = []
    def fn():
        n["c"] += 1
        if n["c"] < 3: raise RateLimitError()
        return "ok"
    assert with_backoff(fn, CFG["cache"]["backoff"], waits.append) == "ok"
    assert waits == [0.5, 1.0]


def test_rate_limit_exhausted_serves_stale():
    t = {"now": NOW}
    clock = lambda: t["now"]
    inner = MockAdapter(CFG, clock)
    state = {"fail": False}

    class Flaky:
        mode = "MOCK"
        def fetch(self, stage):
            if state["fail"]: raise RateLimitError()
            return inner.fetch(stage)

    s = svc(clock, Flaky())
    first = s.fetch_stage(Stage.NEW)
    t["now"] += 60; state["fail"] = True
    assert s.fetch_stage(Stage.NEW) == first
