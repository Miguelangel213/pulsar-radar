import json

from radar.config import load_config
from services.db import SqliteStore
from services.store import JsonStore
from services.token_scanner import TokenScanner, best_pair_per_token, classify, normalize_pair
from tests.helpers import NOW, FakeClient, pair

CFG = load_config()


def scanner(tmp_path, client, clock=lambda: NOW):
    store = JsonStore(tmp_path, history_interval_s=60, history_max_rows=1000)
    return TokenScanner(client, CFG, store, clock), store


def test_normalize_extracts_required_fields():
    t = normalize_pair(pair(addr="A", symbol="AAA", age_min=10, boosts=3), NOW * 1000)
    assert (t.address, t.symbol, t.name) == ("A", "AAA", "AAA coin")
    assert t.price_usd == 0.00005 and t.liquidity_usd == 30000 and t.market_cap == 50000 and t.fdv == 50000
    assert t.volume.h1 == 20000 and t.buys.h1 == 120 and t.sells.h1 == 60 and abs(t.age_min - 10) < 1e-6
    assert t.website == "https://site.example" and t.socials[0].type == "twitter" and t.boosts_active == 3


def test_normalize_handles_missing_liquidity_and_fields():
    p = pair(dex="pumpfun", liq=None); del p["info"]; p["marketCap"] = None
    t = normalize_pair(p, NOW * 1000)
    assert t.liquidity_usd is None and t.market_cap == 50000 and t.website is None and t.socials == []


def test_best_pair_prefers_liquidity_and_solana_only():
    pairs = [pair("A", liq=1000), pair("A", dex="raydium", liq=9000), pair("B", chain="ethereum")]
    pairs[1]["pairAddress"] = "best"
    best = best_pair_per_token(pairs, "solana")
    assert set(best) == {"A"} and best["A"]["pairAddress"] == "best"


def test_classify_stages():
    t = lambda **kw: normalize_pair(pair(**kw), NOW * 1000)
    assert "new_creation" in classify(t(age_min=30), CFG)
    assert "new_creation" not in classify(t(age_min=500), CFG)
    assert "near_graduation" in classify(t(dex="pumpfun", liq=None, mcap=45000, age_min=300), CFG)
    assert "near_graduation" not in classify(t(dex="pumpfun", liq=None, mcap=10000), CFG)
    assert "graduated" in classify(t(dex="pumpswap", age_min=100), CFG)
    assert "trending" in classify(t(boosts=5), CFG)


def test_scan_discovers_only_solana_and_batches(tmp_path):
    many = [f"T{i}" for i in range(65)]
    client = FakeClient(pairs=[pair(a) for a in many], boosts_latest=many[:40], boosts_top=[("ETHTOKEN", "ethereum")], profiles=many[40:])
    sc, _ = scanner(tmp_path, client)
    es = sc.scan()
    assert len(es) == 65 and "ETHTOKEN" not in sc.tracked
    assert [len(b) for b in client.token_info_calls] == [30, 30, 5]       # lotes de 30


def test_scan_interval_reuses_last_result(tmp_path):
    t = {"now": NOW}
    client = FakeClient(pairs=[pair("A")], boosts_latest=["A"])
    sc, _ = scanner(tmp_path, client, lambda: t["now"])
    sc.scan(); calls = client.calls
    t["now"] += 5
    sc.scan()
    assert client.calls == calls
    t["now"] += 20
    sc.scan()
    assert client.calls > calls


def test_scan_persists_tokens_and_history_files(tmp_path):
    client = FakeClient(pairs=[pair("A"), pair("B", symbol="BBB")], boosts_latest=["A", "B"])
    sc, _ = scanner(tmp_path, client)
    sc.scan()
    tokens = json.loads((tmp_path / "tokens.json").read_text())
    assert set(tokens["tokens"]) == {"A", "B"} and "potential" in tokens["tokens"]["A"] and tokens["tracked"]["A"]["sources"] == ["boost_latest"]
    hist = json.loads((tmp_path / "history.json").read_text())["entries"]
    assert {h["address"] for h in hist} == {"A", "B"} and all(h["price_usd"] == 0.00005 for h in hist)


def test_history_is_throttled_per_token(tmp_path):
    t = {"now": NOW}
    client = FakeClient(pairs=[pair("A")], boosts_latest=["A"])
    sc, store = scanner(tmp_path, client, lambda: t["now"])
    sc.scan()
    t["now"] += 20; sc.scan(force=True)       # <60 s: no se añade fila
    assert len(store.history) == 1
    t["now"] += 60; sc.scan(force=True)
    assert len(store.history) == 2


def test_tracked_survive_restart_and_expire(tmp_path):
    t = {"now": NOW}
    client = FakeClient(pairs=[pair("A")], boosts_latest=["A"])
    sc, _ = scanner(tmp_path, client, lambda: t["now"])
    sc.scan()
    client2 = FakeClient(pairs=[pair("A")])                 # ya no aparece en ningún feed
    sc2, _ = scanner(tmp_path, client2, lambda: t["now"] + 3600)
    assert "A" in sc2.tracked and len(sc2.scan()) == 1      # se sigue tras reiniciar
    sc3, _ = scanner(tmp_path, client2, lambda: t["now"] + 27 * 3600)
    sc3.scan()
    assert "A" not in sc3.tracked                            # caducó (track_hours)


def test_api_failure_keeps_last_good_state(tmp_path):
    t = {"now": NOW}
    client = FakeClient(pairs=[pair("A")], boosts_latest=["A"])
    sc, _ = scanner(tmp_path, client, lambda: t["now"])
    first = sc.scan()
    client.fail = True; t["now"] += 60
    assert sc.scan() == first and sc.last_error == "caído"


def test_max_tracked_cap(tmp_path):
    n = CFG["scanner"]["max_tracked"] + 20
    addrs = [f"T{i}" for i in range(n)]
    client = FakeClient(pairs=[pair(a) for a in addrs], boosts_latest=addrs)
    sc, _ = scanner(tmp_path, client)
    sc.scan()
    assert len(sc.tracked) == CFG["scanner"]["max_tracked"]


def test_links_are_generated_from_addresses():
    t = normalize_pair(pair(addr="MINT123", symbol="AAA"), NOW * 1000, CFG["links"])
    assert t.links["dexscreener"] == "https://dexscreener.com/solana/pairMINT123"
    assert t.links["solscan"] == "https://solscan.io/token/MINT123"
    assert t.links["birdeye"] == "https://birdeye.so/token/MINT123?chain=solana"
    assert t.links["gmgn"] == "https://gmgn.ai/sol/token/MINT123"
    assert t.links["dexscreener_chart"].startswith("https://dexscreener.com/solana/pairMINT123?")


def test_scan_fills_links_on_every_token(tmp_path):
    client = FakeClient(pairs=[pair("A"), pair("B")], boosts_latest=["A", "B"])
    sc, _ = scanner(tmp_path, client)
    assert all(set(e.entry.token.links) == {"dexscreener", "dexscreener_chart", "solscan", "birdeye", "gmgn"} for e in sc.scan())


def test_sqlite_stores_required_fields_and_history(tmp_path):
    t = {"now": NOW}
    db = SqliteStore(tmp_path / "radar.db", history_interval_s=60)
    client = FakeClient(pairs=[pair("A", symbol="AAA", boosts=2)], boosts_latest=["A"])
    sc = TokenScanner(client, CFG, JsonStore(tmp_path, 60, 100), lambda: t["now"], db=db)
    sc.scan()
    row = db.get_token("A")
    assert (row["token_address"], row["pair_address"], row["symbol"], row["name"]) == ("A", "pairA", "AAA", "AAA coin")
    assert row["market_cap"] == 50000 and row["liquidity_usd"] == 30000 and row["fdv"] == 50000
    assert row["volume_24h"] == 160000 and row["buys_24h"] == 1200 and row["sells_24h"] == 600
    assert row["website"] == "https://site.example" and row["socials"][0]["type"] == "twitter" and row["pair_created_at"]
    t["now"] += 20; sc.scan(force=True)
    assert len(db.history("A")) == 1                       # throttle de histórico
    t["now"] += 60; sc.scan(force=True)
    h = db.history("A")
    assert len(h) == 2 and h[0]["ts"] < h[1]["ts"] and h[0]["price_usd"] == 0.00005
    assert db.counts() == {"tokens": 1, "history": 2}


def test_sqlite_persists_across_restart(tmp_path):
    db = SqliteStore(tmp_path / "radar.db", 60)
    sc = TokenScanner(FakeClient(pairs=[pair("A")], boosts_latest=["A"]), CFG, JsonStore(tmp_path, 60, 100), lambda: NOW, db=db)
    sc.scan()
    db2 = SqliteStore(tmp_path / "radar.db", 60)
    assert db2.get_token("A")["symbol"] == "AAA" and len(db2.history("A")) == 1
