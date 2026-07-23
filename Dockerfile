FROM ghcr.io/astral-sh/uv:0.11.16 AS uv
FROM nvidia/cuda:13.0.2-devel-ubuntu24.04

COPY --from=uv /uv /uvx /bin/
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --extra judge --locked --no-install-project

COPY app.py challenge_repository.py upstream_judge.py python_judge.py python_submission_worker.py ./
COPY scripts ./scripts
COPY static ./static
RUN git clone https://github.com/AlphaGPU/leetgpu-challenges.git upstream/leetgpu-challenges

ENV LEETGPU_HOST=0.0.0.0 LEETGPU_PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD [".venv/bin/python", "app.py"]
