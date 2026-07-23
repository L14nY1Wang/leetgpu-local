"""Read challenge metadata directly from the official upstream checkout."""

from __future__ import annotations

import ast
import html
import re
import subprocess
from pathlib import Path

from judge_config import effective_tolerances, load_float32_matmul_precisions


LANGUAGE_FILES = {
    "cuda": "starter.cu",
    "pytorch": "starter.pytorch.py",
    "triton": "starter.triton.py",
    "cutedsl": "starter.cute.py",
}


def _class_metadata(path: Path) -> dict:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    result = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Challenge":
            for statement in node.body:
                if isinstance(statement, (ast.Assign, ast.AnnAssign)):
                    target = statement.targets[0] if isinstance(statement, ast.Assign) else statement.target
                    if isinstance(target, ast.Name) and target.id in {"name", "atol", "rtol", "num_gpus", "access_tier"}:
                        try:
                            result[target.id] = ast.literal_eval(statement.value)
                        except (ValueError, TypeError):
                            pass
            break
    return result


def _plain_summary(markup: str) -> str:
    paragraph = re.search(r"<p[^>]*>(.*?)</p>", markup, re.IGNORECASE | re.DOTALL)
    content = paragraph.group(1) if paragraph else markup
    content = re.sub(r"<[^>]+>", " ", content)
    return " ".join(html.unescape(content).split())[:260]


def _signature(source: str) -> str:
    match = re.search(
        r'extern\s+"C"\s+(?:[\w:<>]+\s+)+solve\s*\((.*?)\)\s*\{',
        source,
        re.DOTALL,
    )
    if not match:
        return "solve(...)"
    args = " ".join(match.group(1).split())
    return f"solve({args})"


def _python_signature(source: str) -> str:
    tree = ast.parse(source)
    solve = next(
        (node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "solve"),
        None,
    )
    if not solve:
        return "def solve(*args):"
    return f"def solve({ast.unparse(solve.args)}):"


def _tilelang_starter(pytorch_starter: str) -> str:
    signature = _python_signature(pytorch_starter)
    return f'''import torch
import tilelang
import tilelang.language as T


# 使用 @tilelang.jit 定义内核，并在 solve 中调用；可以写入输出张量或返回结果。
{signature}
    pass
'''


def _category(title: str) -> str:
    value = title.lower()
    groups = [
        (("attention", "transformer", "embedding", "gpt", "llama"), "AI Models"),
        (("matrix", "gemm", "dot product", "least squares"), "Linear Algebra"),
        (("convolution", "pooling", "blur", "stencil", "image", "rgb", "color"), "Vision"),
        (("relu", "sigmoid", "silu", "swiglu", "geglu", "softmax", "normalization"), "Neural Ops"),
        (("sort", "prefix", "subarray", "histogram", "top-k", "selection", "merge"), "Parallel Algorithms"),
        (("bfs", "shortest", "neighbor", "k-means", "monte carlo"), "Algorithms"),
    ]
    return next((label for words, label in groups if any(word in value for word in words)), "GPU Foundations")


class ChallengeRepository:
    def __init__(self, root: Path):
        self.root = root

    def _directories(self) -> list[Path]:
        challenge_root = self.root / "challenges"
        directories = []
        for difficulty in ("easy", "medium", "hard"):
            directories.extend((challenge_root / difficulty).glob("*/challenge.py"))
        return sorted(
            (path.parent for path in directories),
            key=lambda path: int(path.name.split("_", 1)[0]),
        )

    def _build(self, directory: Path, language: str | None = None, details: bool = False) -> dict:
        challenge_path = directory / "challenge.py"
        metadata = _class_metadata(challenge_path)
        number_text, slug = directory.name.split("_", 1)
        difficulty = directory.parent.name.capitalize()
        title = metadata.get("name") or slug.replace("_", " ").title()
        description_path = directory / "challenge.html"
        description_html = description_path.read_text(encoding="utf-8") if description_path.exists() else ""
        starters = {
            name: directory / "starter" / filename
            for name, filename in LANGUAGE_FILES.items()
            if (directory / "starter" / filename).exists()
        }
        pytorch_path = directory / "starter" / LANGUAGE_FILES["pytorch"]
        if pytorch_path.exists():
            starters["tilelang"] = None
        selected_language = language if language in starters else ("cuda" if "cuda" in starters else next(iter(starters), None))
        result = {
            "id": directory.name,
            "number": int(number_text),
            "slug": slug,
            "title": title,
            "difficulty": difficulty,
            "category": _category(title),
            "summary": _plain_summary(description_html),
            "languages": list(starters),
            "accessTier": metadata.get("access_tier", "free"),
        }
        if details:
            atol, rtol = effective_tolerances(
                directory.name,
                metadata.get("atol"),
                metadata.get("rtol"),
            )
            if selected_language == "tilelang":
                starter = _tilelang_starter(pytorch_path.read_text(encoding="utf-8"))
            else:
                starter_path = starters.get(selected_language)
                starter = starter_path.read_text(encoding="utf-8") if starter_path else ""
            result.update(
                {
                    "descriptionHtml": description_html,
                    "language": selected_language,
                    "starter": starter,
                    "signature": _signature(starter) if selected_language == "cuda" else _python_signature(starter),
                    "atol": atol,
                    "rtol": rtol,
                    "float32MatmulPrecision": load_float32_matmul_precisions().get(
                        directory.name
                    ),
                    "numGpus": metadata.get("num_gpus", 1),
                    "sourceUrl": f"https://github.com/AlphaGPU/leetgpu-challenges/tree/main/challenges/{directory.parent.name}/{directory.name}",
                }
            )
        return result

    def list(self) -> list[dict]:
        return [self._build(directory) for directory in self._directories()]

    def get(self, challenge_id: str, language: str | None = None) -> dict | None:
        if not re.fullmatch(r"\d+_[A-Za-z0-9_]+", challenge_id):
            return None
        for directory in self._directories():
            if directory.name == challenge_id:
                return self._build(directory, language=language, details=True)
        return None

    def path_for(self, challenge_id: str) -> Path | None:
        for directory in self._directories():
            if directory.name == challenge_id:
                return directory
        return None

    def status(self) -> dict:
        if not (self.root / ".git").exists():
            return {"available": False, "count": 0, "commit": None}
        commit = subprocess.run(
            ["git", "-C", str(self.root), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return {
            "available": True,
            "count": len(self._directories()),
            "commit": commit.stdout.strip() if commit.returncode == 0 else None,
        }

    def sync(self) -> dict:
        if not (self.root / ".git").exists():
            raise RuntimeError("缺少上游题库，请先运行 scripts/sync_upstream.py。")
        result = subprocess.run(
            ["git", "-C", str(self.root), "pull", "--ff-only"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError((result.stdout + result.stderr).strip())
        return {**self.status(), "output": (result.stdout + result.stderr).strip()}
