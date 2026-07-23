"""Run Python-based GPU submissions in an isolated worker process."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


SUPPORTED_LANGUAGES = {"pytorch", "triton", "cutedsl", "tilelang"}
RESULT_MARKER = "__LEETGPU_RESULT__="


def judge_python(directory: Path, source: str, language: str, submit: bool = False) -> dict:
    if language not in SUPPORTED_LANGUAGES:
        return {"passed": False, "stage": "environment", "output": "不支持该 Python GPU 语言。"}

    with tempfile.TemporaryDirectory(prefix=f"leetgpu-{language}-") as temp_dir:
        source_path = Path(temp_dir) / "submission.py"
        source_path.write_text(source, encoding="utf-8")
        command = [
            sys.executable,
            str(Path(__file__).with_name("python_submission_worker.py")),
            str(directory),
            str(source_path),
            language,
            "submit" if submit else "run",
        ]
        try:
            nvcc = shutil.which("nvcc")
            detected_cuda_home = str(Path(nvcc).resolve().parent.parent) if nvcc else ""
            worker_env = {
                **os.environ,
                "CUDA_CACHE_DISABLE": "1",
                # TileLang does not resolve symlinked nvcc launchers when discovering headers.
                "CUDA_HOME": os.environ.get("CUDA_HOME", detected_cuda_home),
                "TILELANG_CACHE_DIR": os.environ.get(
                    "TILELANG_CACHE_DIR", "/tmp/leetgpu-tilelang-cache"
                ),
                "TILELANG_TMP_DIR": os.environ.get(
                    "TILELANG_TMP_DIR", "/tmp/leetgpu-tilelang-cache/tmp"
                ),
            }
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=300 if submit else 180,
                env=worker_env,
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "stage": "run", "output": "提交运行超时。"}

        combined = result.stdout + result.stderr
        marker_position = combined.rfind(RESULT_MARKER)
        if marker_position < 0:
            return {
                "passed": False,
                "stage": "run",
                "output": combined[-16000:] or "提交进程异常退出。",
            }
        payload = combined[marker_position + len(RESULT_MARKER) :].splitlines()[0]
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {"passed": False, "stage": "run", "output": "无法解析提交进程的判题结果。"}
