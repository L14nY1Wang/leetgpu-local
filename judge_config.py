"""Load local judge settings without modifying the upstream challenge checkout."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


CONFIG_PATH = Path(__file__).with_name("judge_overrides.json")
MATMUL_PRECISIONS = {"highest", "high", "medium"}


@lru_cache(maxsize=1)
def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_judge_overrides() -> dict[str, dict[str, float]]:
    tolerances = _load_config().get("tolerances", {})
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


@lru_cache(maxsize=1)
def load_float32_matmul_precisions() -> dict[str, str]:
    precisions = _load_config().get("float32MatmulPrecision", {})
    if not isinstance(precisions, dict):
        raise ValueError("judge_overrides.json 中的 float32MatmulPrecision 必须是对象。")
    for challenge_id, precision in precisions.items():
        if not isinstance(challenge_id, str) or precision not in MATMUL_PRECISIONS:
            raise ValueError(
                f"题目 {challenge_id} 的 FP32 matmul 精度必须是："
                f"{sorted(MATMUL_PRECISIONS)}"
            )
    return precisions


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
    precision = load_float32_matmul_precisions().get(challenge_id)
    if precision:
        original_reference = challenge.reference_impl

        def reference_with_matmul_precision(*args, **kwargs):
            import torch

            previous = torch.get_float32_matmul_precision()
            torch.set_float32_matmul_precision(precision)
            try:
                return original_reference(*args, **kwargs)
            finally:
                torch.set_float32_matmul_precision(previous)

        challenge.reference_impl = reference_with_matmul_precision
    return challenge
