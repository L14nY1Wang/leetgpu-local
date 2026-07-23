# Kernelyard / LeetGPU Local

English | [简体中文](README.zh-CN.md)

A self-hosted challenge browser and GPU judge for the official
[`AlphaGPU/leetgpu-challenges`](https://github.com/AlphaGPU/leetgpu-challenges)
repository.

The UI has two levels:

1. `/` is the searchable challenge index.
2. `/challenge/<id>` is a dedicated problem statement and code workspace.

The server reads `challenge.py`, `challenge.html`, and every starter file
directly from the upstream checkout. There is no duplicated challenge manifest
to maintain. At the time of this build the repository contains 89 challenges,
88 of which provide CUDA, Triton, and CuTeDSL starters. PyTorch is available
for all 89 challenges, and a TileLang starter is generated from each official
`solve` signature.

## Requirements

- Python 3.12
- uv
- Git
- NVIDIA driver and GPU
- CUDA Toolkit with `nvcc`
- Python packages from the `judge` extra, including PyTorch, Triton, CuTeDSL,
  and TileLang

## Install

Clone this repository together with the official challenge submodule:

```bash
git clone --recurse-submodules <repository-url>
cd leetgpu-local
```

If the repository was cloned without submodules, initialize it with:

```bash
git submodule update --init --recursive
```

Then install the Python environment:

```bash
uv venv --python 3.12 .venv
UV_CACHE_DIR=/tmp/leetgpu-uv-cache uv sync --extra judge --locked
```

The cache override is only needed when the default uv cache is not writable.

## Run

```bash
source .venv/bin/activate
python app.py
```

Open `http://localhost:8080`. Set `LEETGPU_PORT` to use another port.

## Sync challenges

Use the **Sync repository** button on the index, or run:

```bash
.venv/bin/python scripts/sync_upstream.py
```

Both paths execute a fast-forward-only pull inside the challenge submodule.
New, removed, and modified upstream challenges are reflected by the API and UI
immediately after the checkout changes. After updating the challenge checkout,
commit the new submodule pointer in this repository when the update should be
shared with other users.

Set `LEETGPU_CHALLENGES=/path/to/checkout` to read a different checkout.

## Judge

CUDA submissions are compiled into a shared library with `nvcc`. The judge
loads the selected upstream `Challenge`, creates its official sample or
functional tests, runs `reference_impl` with PyTorch, invokes the submitted
`solve` entrypoint through `ctypes`, and compares every output using the
challenge's official `atol` and `rtol` values.

PyTorch, Triton, CuTeDSL, and TileLang submissions run in isolated Python
worker processes against the same official tests. The editor intentionally
exposes only CUDA and these four supported Python GPU languages.

The workspace uses a bundled CodeMirror 6 editor with CUDA/C++ and Python
syntax highlighting, bracket matching, search, real-tab indentation, and local
completion for common GPU APIs, `solve` parameters, and identifiers in the
current document. Press `Ctrl+Space` to request completion and `Ctrl+Enter` to
run the sample tests.

After correctness checks pass, the judge benchmarks the official
`generate_performance_test()` input. It reports the average GPU time after
warmup for both the official PyTorch `reference_impl` and the submission, plus
the speedup calculated as `baseline time / submission time`. JIT and source
compilation time are excluded.

Problem statements render their bundled LaTeX locally with KaTeX, so formula
display does not depend on an external CDN.

## Frontend development

The generated editor bundle is committed so production does not require
Node.js. After changing `static/editor.js`, rebuild it with:

```bash
npm install
npm run build:editor
```

## Docker

Docker requires NVIDIA Container Toolkit:

```bash
docker compose up --build
```

The image clones the official challenge repository while building. The Sync
button can fast-forward that checkout later.

## Local data

Editor drafts and completion records are stored in the browser's
`localStorage`. The repository's `solutions/` directory is reserved for local
solutions and is excluded from Git by `.gitignore`.

## Security and license

Submissions are arbitrary native CUDA/C++ code. Run this service only for
trusted users on a trusted network. A public or multi-user deployment requires
a hardened runner sandbox with process, filesystem, network, and resource
isolation.

The upstream challenge content remains in its own Git submodule and is governed
by its CC BY-NC-ND 4.0 license. This project reads those files without modifying
or republishing them.
