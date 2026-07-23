#!/usr/bin/env python3
"""Self-hosted LeetGPU challenge browser and multi-language GPU judge."""

from __future__ import annotations

import json
import importlib.util
import os
import shutil
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from challenge_repository import ChallengeRepository
from python_judge import SUPPORTED_LANGUAGES, judge_python
from upstream_judge import judge


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
UPSTREAM_DIR = Path(os.environ.get("LEETGPU_CHALLENGES", ROOT / "upstream" / "leetgpu-challenges"))
REPOSITORY = ChallengeRepository(UPSTREAM_DIR)
MAX_SOURCE_BYTES = 100_000


def gpu_available() -> bool:
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return False
    try:
        result = subprocess.run(
            [nvidia_smi, "-L"], capture_output=True, text=True, timeout=3
        )
        return result.returncode == 0 and "GPU" in result.stdout
    except subprocess.TimeoutExpired:
        return False


class PracticeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self) -> None:
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, payload: dict | list, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            has_nvcc = bool(shutil.which(os.environ.get("NVCC", "nvcc")))
            has_gpu = gpu_available()
            try:
                import torch
                has_torch = torch.cuda.is_available()
            except ImportError:
                has_torch = False
            languages = {
                "cuda": has_nvcc and has_gpu and has_torch,
                "pytorch": has_gpu and has_torch,
                "triton": has_gpu and has_torch and importlib.util.find_spec("triton") is not None,
                "cutedsl": has_gpu and has_torch and importlib.util.find_spec("cutlass") is not None,
                "tilelang": has_gpu and has_torch and importlib.util.find_spec("tilelang") is not None,
            }
            self.send_json(
                {
                    "ok": True,
                    "nvcc": has_nvcc,
                    "gpu": has_gpu,
                    "torch": has_torch,
                    "ready": all(languages.values()),
                    "languages": languages,
                }
            )
            return
        if path == "/api/upstream":
            self.send_json(REPOSITORY.status())
            return
        if path == "/api/challenges":
            self.send_json(REPOSITORY.list())
            return
        if path.startswith("/api/challenges/"):
            challenge_id = path.rsplit("/", 1)[-1]
            query = parse_qs(urlparse(self.path).query)
            language = query.get("language", [None])[0]
            challenge = REPOSITORY.get(challenge_id, language=language)
            if challenge:
                self.send_json(challenge)
            else:
                self.send_json({"error": "找不到该题目。"}, HTTPStatus.NOT_FOUND)
            return
        if path.startswith("/challenge/"):
            self.path = "/challenge.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/upstream/sync":
            try:
                self.send_json(REPOSITORY.sync())
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_GATEWAY)
            return
        if path != "/api/run":
            self.send_json({"error": "找不到该接口。"}, HTTPStatus.NOT_FOUND)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length > MAX_SOURCE_BYTES:
                raise ValueError("提交的源代码过大。")
            payload = json.loads(self.rfile.read(content_length))
            challenge_id = payload.get("challengeId", "")
            language = payload.get("language", "cuda")
            challenge = REPOSITORY.get(challenge_id, language=language)
            challenge_path = REPOSITORY.path_for(challenge_id)
            source = payload.get("source", "")
            if not challenge or not challenge_path:
                raise ValueError("题目不存在。")
            if language not in challenge["languages"] or challenge["language"] != language:
                raise ValueError("该题目没有提供所选语言的初始代码。")
            if language != "cuda" and language not in SUPPORTED_LANGUAGES:
                raise ValueError("不支持所选提交语言。")
            if not isinstance(source, str) or not source.strip():
                raise ValueError("源代码不能为空。")
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        if language == "cuda":
            result = judge(challenge_path, source, submit=bool(payload.get("submit")))
        else:
            result = judge_python(
                challenge_path,
                source,
                language,
                submit=bool(payload.get("submit")),
            )
        self.send_json(result)


def main() -> None:
    host = os.environ.get("LEETGPU_HOST", "0.0.0.0")
    port = int(os.environ.get("LEETGPU_PORT", "8080"))
    server = ThreadingHTTPServer((host, port), PracticeHandler)
    print(f"LeetGPU Local is running at http://{host}:{port}")
    print("Warning: submissions execute native CUDA code. Keep this service on a trusted network.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
