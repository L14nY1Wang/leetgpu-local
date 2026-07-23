"""Load local judge settings without modifying the upstream challenge checkout."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


CONFIG_PATH = Path(__file__).with_name("judge_overrides.json")


@lru_cache(maxsize=1)
def load_judge_overrides() -> dict[str, dict[str, float]]:
    if not CONFIG_PATH.exists():
        return {}
    payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    tolerances = payload.get("tolerances", {})
    if not isinstance(tolerances, dict):
        raise ValueError("judge_overrides.json 中的 tolerances 必须是对象。")

    result = {}
    for challenge_id, values in tolerances.items():
        if not isinstance(challenge_id, str) or not isinstance(values, dict):
            raise ValueError("每项容差覆盖必须使用题目 ID 和对象值。")
        unknown = set(values) - {"atol", "rtol"}
        if unknown:
            raise ValueError(f"题目 {challenge_id} 包含未知容差字段：{sorted(unknown)}")
        normalized = {}
        for name, value in values.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise ValueError(f"题目 {challenge_id} 的 {name} 必须是非负数。")
            normalized[name] = float(value)
        result[challenge_id] = normalized
    return result


def effective_tolerances(
    challenge_id: str, atol: float, rtol: float
) -> tuple[float, float]:
    override = load_judge_overrides().get(challenge_id, {})
    return (
        override.get("atol", atol),
        override.get("rtol", rtol),
    )


def apply_challenge_overrides(challenge_id: str, challenge):
    challenge.atol, challenge.rtol = effective_tolerances(
        challenge_id, challenge.atol, challenge.rtol
    )
    return challenge
