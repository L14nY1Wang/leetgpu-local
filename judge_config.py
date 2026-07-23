"""Load local judge settings without modifying the upstream challenge checkout."""

from __future__ import annotations

import json
import math
import os
import tempfile
from pathlib import Path


CONFIG_PATH = Path(__file__).with_name("judge_overrides.json")
MATMUL_PRECISIONS = {"highest", "high", "medium"}
CONFIG_KEYS = {"tolerances", "float32MatmulPrecision"}


def validate_judge_config(payload) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("判题配置必须是 JSON 对象。")

    unknown = set(payload) - CONFIG_KEYS
    if unknown:
        raise ValueError(f"判题配置包含未知字段：{sorted(unknown)}")

    tolerances = payload.get("tolerances", {})
    if not isinstance(tolerances, dict):
        raise ValueError("judge_overrides.json 中的 tolerances 必须是对象。")

    normalized_tolerances = {}
    for challenge_id, values in tolerances.items():
        if not isinstance(challenge_id, str) or not challenge_id.strip() or not isinstance(values, dict):
            raise ValueError("每项容差覆盖必须使用非空题目 ID 和对象值。")
        unknown_values = set(values) - {"atol", "rtol"}
        if unknown_values:
            raise ValueError(f"题目 {challenge_id} 包含未知容差字段：{sorted(unknown_values)}")
        normalized_values = {}
        for name, value in values.items():
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                or value < 0
            ):
                raise ValueError(f"题目 {challenge_id} 的 {name} 必须是有限的非负数。")
            normalized_values[name] = float(value)
        if normalized_values:
            normalized_tolerances[challenge_id] = normalized_values

    precisions = payload.get("float32MatmulPrecision", {})
    if not isinstance(precisions, dict):
        raise ValueError("judge_overrides.json 中的 float32MatmulPrecision 必须是对象。")
    normalized_precisions = {}
    for challenge_id, precision in precisions.items():
        if not isinstance(challenge_id, str) or not challenge_id.strip() or precision not in MATMUL_PRECISIONS:
            raise ValueError(
                f"题目 {challenge_id} 的 FP32 matmul 精度必须是："
                f"{sorted(MATMUL_PRECISIONS)}"
            )
        normalized_precisions[challenge_id] = precision

    return {
        "tolerances": normalized_tolerances,
        "float32MatmulPrecision": normalized_precisions,
    }


def read_judge_config() -> dict:
    if not CONFIG_PATH.exists():
        return validate_judge_config({})
    try:
        payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"judge_overrides.json 不是有效 JSON：{error.msg}") from error
    return validate_judge_config(payload)


def save_judge_config(payload) -> dict:
    normalized = validate_judge_config(payload)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    mode = CONFIG_PATH.stat().st_mode & 0o777 if CONFIG_PATH.exists() else 0o644
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{CONFIG_PATH.name}.", suffix=".tmp", dir=CONFIG_PATH.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(normalized, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary_path.chmod(mode)
        os.replace(temporary_path, CONFIG_PATH)
    finally:
        temporary_path.unlink(missing_ok=True)
    return normalized


def load_judge_overrides() -> dict[str, dict[str, float]]:
    return read_judge_config()["tolerances"]


def load_float32_matmul_precisions() -> dict[str, str]:
    return read_judge_config()["float32MatmulPrecision"]


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
