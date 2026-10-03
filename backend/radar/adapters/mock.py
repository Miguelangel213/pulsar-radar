from __future__ import annotations

import random
import time
from typing import Callable, List

from ..models import Stage, Token

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
NARRATIVES = ["ai", "politics", "cats", "dogs", "gaming", "celebrity", "anime", "memes"]
ARCHETYPES = [("solid", 0.30), ("average", 0.35), ("risky", 0.20), ("honeypot", 0.08), ("rugdev", 0.07)]


class MockAdapter:
    """Universo determinista y sin estado: el token #i nace en i*spawn_every_s y evoluciona con el reloj.
    Esquema PROVISIONAL (ver models.Token)."""
    mode = "MOCK"

    def __init__(self, cfg, clock: Callable[[], float] = time.time):
        self.m = cfg["mock"]
        self.stages = cfg["stages"]
        self.clock = clock

    def _build(self, i: int, now: float) -> Token:
        r = random.Random(self.m["seed"] * 100003 + i)
        born = i * self.m["spawn_every_s"]
        age_min = (now - born) / 60
        kind = r.choices([a for a, _ in ARCHETYPES], [w for _, w in ARCHETYPES])[0]
        speed = r.uniform(0.01, 0.10) if kind != "solid" else r.uniform(0.04, 0.12)   # progreso/min
        progress = min(1.0, speed * age_min)
        grad_age = max(0.0, age_min - 1.0 / speed) if progress >= 1 else None
        stage = Stage.GRADUATED if progress >= 1 else (Stage.NEAR if progress >= self.stages["near_graduation"]["min_curve_progress"] else Stage.NEW)
        bad = kind in ("risky", "honeypot", "rugdev")
        cap = 4000 + progress * 65000 * r.uniform(0.7, 1.4) * (1 + max(0, age_min - 25) * 0.01 if progress >= 1 else 1)
        buys = int(age_min * r.uniform(8, 40)) + 3
        sells = int(buys * (r.uniform(0.7, 1.3) if bad else r.uniform(0.2, 0.6)))
        tag = r.choice(NARRATIVES)
        return Token(
            address="".join(r.choices(B58, k=40)) + "pump", symbol=f"{tag[:3].upper()}{i % 1000}", name=f"{tag.title()} Coin {i}",
            stage=stage, age_min=round(age_min, 2), price=cap / 1e9, market_cap=round(cap, 2),
            liquidity=round(cap * r.uniform(0.15, 0.45) * (0.4 if bad else 1), 2),
            volume=round(cap * r.uniform(0.5, 4) * (age_min / 30 + 0.2), 2),
            holders=int(30 + age_min * r.uniform(5, 30)), curve_progress=round(progress, 4),
            unique_buyers=int(buys * r.uniform(0.4, 0.9)), buys=buys, sells=sells, narrative_tags=[tag],
            is_honeypot=True if kind == "honeypot" else False,
            buy_tax_pct=round(r.uniform(0, 1.5), 1), sell_tax_pct=round(r.uniform(25, 60), 1) if kind == "honeypot" else round(r.uniform(0, 1.5), 1),
            mint_renounced=not (bad and r.random() < 0.6), freeze_renounced=not (bad and r.random() < 0.5),
            rug_ratio=round(r.uniform(0.35, 0.8) if kind == "rugdev" else r.uniform(0, 0.15 if not bad else 0.35), 2),
            bundler_rate=round(r.uniform(0.0, 0.12) if not bad else r.uniform(0.1, 0.5), 2),
            sniper_rate=round(r.uniform(0.0, 0.10) if not bad else r.uniform(0.05, 0.4), 2),
            top10_rate=round(r.uniform(0.12, 0.30) if not bad else r.uniform(0.25, 0.65), 2),
            dev_hold_rate=round(r.uniform(0, 0.08) if not bad else r.uniform(0.05, 0.35), 2),
            dev_rug_count=r.randint(2, 6) if kind == "rugdev" else 0,
            dev_token_count=r.randint(1, 12), dev_sold=bad and r.random() < 0.5,
            smart_money_buyers=r.randint(1, 6) if kind == "solid" else r.randint(0, 2),
            kol_buyers=r.randint(0, 3) if kind == "solid" else (1 if r.random() < 0.1 else 0),
            smart_money_first_entry_min=round(r.uniform(0.2, 4), 1) if kind == "solid" or r.random() < 0.3 else None,
        ), grad_age

    def fetch(self, stage: Stage) -> List[Token]:
        now = self.clock()
        last = int(now // self.m["spawn_every_s"])
        first = max(0, last - int(self.m["window_min"] * 60 // self.m["spawn_every_s"]))
        built = [self._build(i, now) for i in range(first, last + 1)]
        out: List[Token] = []
        for t, grad_age in built:
            if stage == Stage.NEW and t.stage == Stage.NEW and t.age_min <= self.stages["new_creation"]["max_age_min"]:
                out.append(t)
            elif stage == Stage.NEAR and t.stage == Stage.NEAR:
                out.append(t)
            elif stage == Stage.GRADUATED and t.stage == Stage.GRADUATED and grad_age is not None \
                    and grad_age <= self.stages["graduated"]["max_age_since_graduation_min"]:
                out.append(t)
            elif stage == Stage.TRENDING and t.age_min > 5:
                out.append(t)
        if stage == Stage.TRENDING:
            out = sorted(out, key=lambda x: x.volume, reverse=True)[:30]
        return [t.model_copy(update={"stage": stage}) for t in out]
