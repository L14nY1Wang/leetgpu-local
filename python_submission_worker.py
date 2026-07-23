"""Worker process for PyTorch, Triton, CuTeDSL, and TileLang submissions."""

from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

from python_judge import RESULT_MARKER
from upstream_judge import _benchmark_cuda, _clone_case, _load_challenge, _performance_log


def _load_submission(path: Path):
    spec = importlib.util.spec_from_file_location("leetgpu_user_submission", path)
    if not spec or not spec.loader:
        raise RuntimeError("无法加载提交代码。")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(getattr(module, "solve", None)):
        raise RuntimeError("提交代码必须定义可调用的 solve 函数。")
    return module


def _apply_result(result, actual: dict, signature: dict, torch) -> None:
    if result is None:
        return
    output_names = [name for name, (_, direction) in signature.items() if direction in {"out", "inout"}]
    if isinstance(result, dict):
        values = [result[name] for name in output_names]
    elif isinstance(result, (tuple, list)):
        values = list(result)
    else:
        values = [result]
    if len(values) != len(output_names):
        raise RuntimeError("solve 返回值数量与题目输出数量不一致。")
    for name, value in zip(output_names, values):
        if isinstance(value, torch.Tensor) and value.data_ptr() != actual[name].data_ptr():
            actual[name].copy_(value)


def _prepare_solve(submission, language: str, actual: dict, signature: dict, torch):
    arguments = [actual[name] for name in signature]
    if language == "cutedsl":
        import cutlass.cute as cute
        from cutlass.cute.runtime import from_dlpack

        cute_arguments = [
            from_dlpack(value).mark_layout_dynamic() if isinstance(value, torch.Tensor) else value
            for value in arguments
        ]
        compiled = cute.compile(submission.solve, *cute_arguments)
        return lambda: compiled(*cute_arguments)
    return lambda: submission.solve(*arguments)


def _run_prepared_solve(solve, actual: dict, signature: dict, torch):
    result = solve()
    _apply_result(result, actual, signature, torch)
    return result


def run(directory: Path, source_path: Path, language: str, submit: bool) -> dict:
    import torch

    if not torch.cuda.is_available():
        return {"passed": False, "stage": "environment", "output": "PyTorch 无法访问 CUDA 设备。"}
    submission = _load_submission(source_path)
    challenge = _load_challenge(directory)
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
        solve = _prepare_solve(submission, language, actual, signature, torch)
        _run_prepared_solve(solve, actual, signature, torch)
        torch.cuda.synchronize()
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
    solve = _prepare_solve(submission, language, submission_case, signature, torch)
    _run_prepared_solve(solve, submission_case, signature, torch)
    torch.cuda.synchronize()
    baseline_ms = _benchmark_cuda(lambda: challenge.reference_impl(**baseline_case), torch)
    submission_ms = _benchmark_cuda(
        lambda: _run_prepared_solve(solve, submission_case, signature, torch), torch
    )
    performance_log, performance = _performance_log(baseline_ms, submission_ms)
    logs.append(performance_log)
    return {
        "passed": True,
        "stage": "complete",
        "output": "\n".join(logs),
        "performance": performance,
    }


def main() -> None:
    try:
        result = run(
            Path(sys.argv[1]),
            Path(sys.argv[2]),
            sys.argv[3],
            sys.argv[4] == "submit",
        )
    except ImportError as error:
        result = {"passed": False, "stage": "environment", "output": f"缺少运行依赖：{error}"}
    except Exception as error:
        result = {"passed": False, "stage": "run", "output": f"运行错误（{type(error).__name__}）：{error}"}
    print(f"{RESULT_MARKER}{json.dumps(result, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
