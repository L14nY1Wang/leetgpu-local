"""Generic CUDA judge driven by the upstream challenge definitions."""

from __future__ import annotations

import ctypes
import importlib.util
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def _nvcc_command(nvcc: str, source: Path, output: Path) -> list[str]:
    nvcc_path = Path(nvcc).resolve()
    root = nvcc_path.parent.parent
    machine = platform.machine()
    candidates = [root / "targets" / machine, root / "targets" / f"{machine}-linux"]
    target = next((path for path in candidates if path.is_dir()), candidates[0])
    command = [str(nvcc_path), "-O3", "-std=c++17", "--shared", "-Xcompiler", "-fPIC"]
    if (target.joinpath("include").is_dir()):
        command += ["-I", str(target / "include")]
    if (target.joinpath("lib").is_dir()):
        command += ["-L", str(target / "lib")]
    return command + [str(source), "-o", str(output)]


def _load_challenge(directory: Path):
    challenge_root = directory.parents[1]
    if str(challenge_root) not in sys.path:
        sys.path.insert(0, str(challenge_root))
    module_name = f"leetgpu_upstream_{directory.name}"
    spec = importlib.util.spec_from_file_location(module_name, directory / "challenge.py")
    if not spec or not spec.loader:
        raise RuntimeError("无法加载题目定义。")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Challenge(device="cuda")


def _materialize(value, torch):
    kind = value.__class__.__name__
    dtype_name = getattr(value, "dtype", None)
    dtype = getattr(torch, dtype_name) if isinstance(dtype_name, str) else dtype_name
    if kind == "RandTensor":
        return torch.empty(value.shape, device="cuda", dtype=dtype).uniform_(value.low, value.high)
    if kind == "RandnTensor":
        return torch.empty(value.shape, device="cuda", dtype=dtype).normal_(value.mean, value.std)
    if kind == "RandIntTensor":
        return torch.randint(value.low, value.high, value.shape, device="cuda", dtype=dtype)
    if kind == "FullTensor":
        return torch.full(value.shape, value.value, device="cuda", dtype=dtype)
    if kind == "OutTensor":
        return torch.empty(value.shape, device="cuda", dtype=dtype)
    return value


def _clone_case(case: dict, torch) -> dict:
    result = {}
    for name, raw_value in case.items():
        value = _materialize(raw_value, torch)
        result[name] = value.clone() if isinstance(value, torch.Tensor) else value
    return result


def _call_solve(solve, signature: dict, case: dict, torch) -> None:
    arguments = []
    argtypes = []
    for name, (ctype, _) in signature.items():
        value = case[name]
        argtypes.append(ctype)
        if isinstance(value, torch.Tensor):
            arguments.append(ctypes.cast(value.data_ptr(), ctype))
        else:
            arguments.append(ctype(value))
    solve.argtypes = argtypes
    solve.restype = None
    solve(*arguments)
    torch.cuda.synchronize()


def _benchmark_cuda(callback, torch, warmup: int = 3, iterations: int = 10) -> float:
    """Return average GPU execution time in milliseconds, excluding warmup."""
    for _ in range(warmup):
        callback()
    torch.cuda.synchronize()
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    start.record()
    for _ in range(iterations):
        callback()
    end.record()
    end.synchronize()
    return start.elapsed_time(end) / iterations


def _performance_log(baseline_ms: float, submission_ms: float) -> tuple[str, dict]:
    speedup = baseline_ms / submission_ms if submission_ms > 0 else float("inf")
    metrics = {
        "baselineMs": baseline_ms,
        "submissionMs": submission_ms,
        "speedup": speedup,
    }
    message = (
        "\n性能测试（官方 PyTorch 基线）\n"
        f"基线耗时：{baseline_ms:.4f} 毫秒\n"
        f"提交耗时：{submission_ms:.4f} 毫秒\n"
        f"加速比：{speedup:.2f}x"
    )
    return message, metrics


def judge(directory: Path, source: str, submit: bool = False) -> dict:
    try:
        import torch
    except ImportError:
        return {
            "passed": False,
            "stage": "environment",
            "output": "运行官方参考测试需要安装 PyTorch。请执行：uv sync --extra judge",
        }
    if not torch.cuda.is_available():
        return {"passed": False, "stage": "environment", "output": "PyTorch 无法访问 CUDA 设备。"}
    nvcc = shutil.which("nvcc")
    if not nvcc:
        return {"passed": False, "stage": "environment", "output": "找不到 nvcc，请安装 CUDA Toolkit。"}

    with tempfile.TemporaryDirectory(prefix="leetgpu-upstream-") as temp_dir:
        source_path = Path(temp_dir) / "submission.cu"
        library_path = Path(temp_dir) / "submission.so"
        source_path.write_text(source, encoding="utf-8")
        try:
            compiled = subprocess.run(
                _nvcc_command(nvcc, source_path, library_path),
                capture_output=True,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "stage": "compile", "output": "编译超时。"}
        if compiled.returncode != 0:
            return {"passed": False, "stage": "compile", "output": (compiled.stdout + compiled.stderr)[-16000:]}

        try:
            challenge = _load_challenge(directory)
            solve = ctypes.CDLL(str(library_path)).solve
            signature = challenge.get_solve_signature()
            tests = [challenge.generate_example_test()]
            functional = challenge.generate_functional_test()
            tests.extend(functional if submit else functional[:3])
            logs = []
            started = time.perf_counter()
            for index, case in enumerate(tests, 1):
                expected = _clone_case(case, torch)
                actual = _clone_case(case, torch)
                challenge.reference_impl(**expected)
                _call_solve(solve, signature, actual, torch)
                for name, (_, direction) in signature.items():
                    if direction in {"out", "inout"}:
                        torch.testing.assert_close(
                            actual[name], expected[name], atol=challenge.atol, rtol=challenge.rtol
                        )
                logs.append(f"通过  测试 {index}/{len(tests)}")
            elapsed = (time.perf_counter() - started) * 1000
            test_kind = "功能" if submit else "样例"
            logs.append(f"\n全部官方{test_kind}测试通过，用时 {elapsed:.1f} 毫秒")

            performance_case = challenge.generate_performance_test()
            baseline_case = _clone_case(performance_case, torch)
            submission_case = _clone_case(performance_case, torch)
            baseline_ms = _benchmark_cuda(
                lambda: challenge.reference_impl(**baseline_case), torch
            )
            submission_ms = _benchmark_cuda(
                lambda: _call_solve(solve, signature, submission_case, torch), torch
            )
            performance_log, performance = _performance_log(baseline_ms, submission_ms)
            logs.append(performance_log)
            return {
                "passed": True,
                "stage": "complete",
                "output": "\n".join(logs),
                "performance": performance,
            }
        except Exception as error:
            return {"passed": False, "stage": "run", "output": f"运行错误（{type(error).__name__}）：{error}"}
