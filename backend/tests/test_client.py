import httpx
import pytest

from clients.dexscreener_client import DexScreenerClient, DexScreenerError
from radar.cache import RateLimiter
from radar.config import load_config

CFG = load_config()


def make(handler, clock=None):
    seen = []
    def wrapped(req: httpx.Request):
        seen.append(req)
        return handler(req)
    http = httpx.Client(transport=httpx.MockTransport(wrapped))
    waits = []
    c = DexScreenerClient(CFG, http=http, clock=clock or (lambda: 1000.0), sleep=waits.append)
    return c, seen, waits


def test_endpoints_paths_and_no_auth():
    c, seen, _ = make(lambda r: httpx.Response(200, json={"pairs": []} if "search" in r.url.path else []))
    c.search("pump coin"); c.token_info(["A", "B"]); c.token_pairs("A"); c.boosts_latest(); c.boosts_top(); c.profiles_latest()
    paths = [r.url.raw_path.decode() for r in seen]
    assert paths == ["/latest/dex/search?q=pump%20coin", "/tokens/v1/solana/A,B", "/token-pairs/v1/solana/A",
                     "/token-boosts/latest/v1", "/token-boosts/top/v1", "/token-profiles/latest/v1"]
    assert all("authorization" not in r.headers and "x-apikey" not in r.headers for r in seen)


def test_cache_prevents_duplicate_calls():
    c, seen, _ = make(lambda r: httpx.Response(200, json=[{"x": 1}]))
    c.boosts_latest(); c.boosts_latest()
    assert len(seen) == 1


def test_429_is_retried_with_backoff_then_ok():
    n = {"c": 0}
    def h(r):
        n["c"] += 1
        return httpx.Response(429) if n["c"] < 3 else httpx.Response(200, json=[{"ok": 1}])
    c, _, waits = make(h)
    assert c.boosts_top() == [{"ok": 1}]
    assert waits == [0.5, 1.0]


def test_failure_serves_stale_cache():
    t = {"now": 1000.0}
    state = {"fail": False}
    def h(r): return httpx.Response(500) if state["fail"] else httpx.Response(200, json=[{"v": 1}])
    c, _, _ = make(h, clock=lambda: t["now"])
    assert c.boosts_latest() == [{"v": 1}]
    t["now"] += 500; state["fail"] = True        # caché caducada + API caída
    assert c.boosts_latest() == [{"v": 1}]


def test_failure_without_cache_raises():
    c, _, _ = make(lambda r: httpx.Response(503))
    with pytest.raises(DexScreenerError):
        c.boosts_latest()


def test_client_error_not_retried():
    c, seen, _ = make(lambda r: httpx.Response(404))
    with pytest.raises(DexScreenerError):
        c.token_pairs("X")
    assert len(seen) == 1


def test_rate_limiter_blocks_when_window_full():
    t = {"now": 0.0}; waits = []
    def sleep(s): waits.append(s); t["now"] += s
    rl = RateLimiter(2, 60.0, clock=lambda: t["now"], sleep=sleep)
    rl.acquire(); rl.acquire()
    assert waits == []
    rl.acquire()
    assert waits == [60.0]


def test_limits_come_from_config():
    c, _, _ = make(lambda r: httpx.Response(200, json=[]))
    assert c.limiters["boosts"].max_calls == CFG["dexscreener"]["rate_limits"]["boosts"]
