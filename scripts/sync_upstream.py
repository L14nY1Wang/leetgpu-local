#!/usr/bin/env python3
"""Clone or fast-forward the official challenge repository."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "upstream" / "leetgpu-challenges"
URL = "https://github.com/AlphaGPU/leetgpu-challenges.git"


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if (TARGET / ".git").exists():
        command = ["git", "-C", str(TARGET), "pull", "--ff-only"]
    else:
        command = ["git", "clone", URL, str(TARGET)]
    subprocess.run(command, check=True)


if __name__ == "__main__":
    main()

