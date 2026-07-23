# Kernelyard / LeetGPU Local

[English](README.md) | 简体中文

Kernelyard 是一个可自行部署的 GPU 编程题浏览与判题平台，题目来自官方
[`AlphaGPU/leetgpu-challenges`](https://github.com/AlphaGPU/leetgpu-challenges)
仓库。

界面分为两层：

1. `/` 是支持搜索和难度筛选的题目列表。
2. `/challenge/<id>` 是题目说明与代码编辑工作台。

服务会直接读取上游仓库中的 `challenge.py`、`challenge.html` 和各语言初始代码，
不需要维护重复的题目清单。当前题库包含 89 道题，其中 88 道提供 CUDA、Triton
和 CuTeDSL 初始代码；全部 89 道题均支持 PyTorch，并会根据官方 `solve` 签名生成
TileLang 初始代码。

## 环境要求

- Python 3.12
- uv
- Git
- NVIDIA 驱动和 GPU
- 带有 `nvcc` 的 CUDA Toolkit
- `judge` 可选依赖中的 Python 包，包括 PyTorch、Triton、CuTeDSL 和 TileLang

## 安装

克隆主项目及官方题库 submodule：

```bash
git clone --recurse-submodules <repository-url>
cd leetgpu-local
```

如果克隆时没有拉取 submodule，可以随后初始化：

```bash
git submodule update --init --recursive
```

安装 Python 环境：

```bash
uv venv --python 3.12 .venv
UV_CACHE_DIR=/tmp/leetgpu-uv-cache uv sync --extra judge --locked
```

仅当默认 uv 缓存目录不可写时，才需要设置上述缓存路径。

## 运行

```bash
source .venv/bin/activate
python app.py
```

打开 `http://localhost:8080`。可通过 `LEETGPU_PORT` 设置其他端口。

## 同步题库

可以点击题目列表中的“同步题目仓库”，或执行：

```bash
.venv/bin/python scripts/sync_upstream.py
```

两种方式都会在题库 submodule 中执行仅快进的拉取。上游新增、删除或修改的题目会在
检出内容变化后立即反映到 API 和界面中。如果需要与其他用户共享题库更新，还应在
主项目中提交更新后的 submodule 指针。

设置 `LEETGPU_CHALLENGES=/path/to/checkout` 可以读取其他位置的题库检出。

本地判题参数覆盖写在 `judge_overrides.json` 中。可以按题目 ID 覆盖 `atol`、`rtol` 和
`float32MatmulPrecision`；该配置会同时用于 API 展示、CUDA 判题和 Python GPU 语言
判题，不会修改上游题库。

## 判题机制

CUDA 提交会通过 `nvcc` 编译为动态库。判题器加载所选题目的官方 `Challenge`，生成
官方样例或功能测试，通过 PyTorch 运行 `reference_impl`，再使用 `ctypes` 调用提交的
`solve` 入口，并按照题目指定的 `atol` 和 `rtol` 比较所有输出。

PyTorch、Triton、CuTeDSL 和 TileLang 提交会在独立的 Python 工作进程中运行相同的
官方测试。编辑器只提供 CUDA 和这四种受支持的 Python GPU 语言。

工作台使用项目内置的 CodeMirror 6，支持 CUDA/C++ 和 Python 语法高亮、括号匹配、
搜索、真实 Tab 缩进，以及针对常用 GPU API、`solve` 参数和当前文档标识符的本地补全。
按 `Ctrl+Space` 可主动触发补全，按 `Ctrl+Enter` 可运行样例测试。

正确性测试通过后，判题器会使用官方 `generate_performance_test()` 输入进行性能测试。
预热完成后分别测量官方 PyTorch `reference_impl` 和提交代码的平均 GPU 时间，并报告
`基线耗时 / 提交耗时` 得到的加速比。JIT 和源码编译时间不计入性能结果。

题目说明使用项目内置的 KaTeX 渲染 LaTeX，不依赖外部 CDN。

## 前端开发

生成后的编辑器 bundle 会提交到仓库中，因此生产环境不需要 Node.js。修改
`static/editor.js` 后执行：

```bash
npm install
npm run build:editor
```

## Docker

Docker 运行需要安装 NVIDIA Container Toolkit：

```bash
docker compose up --build
```

镜像构建时会克隆官方题库，之后仍可通过界面中的同步按钮执行快进更新。

## 本地数据

编辑器草稿和完成记录保存在浏览器 `localStorage` 中。仓库中的 `solutions/` 目录用于
本地解题记录，并已加入 `.gitignore`，不会被提交到 Git。

## 安全与许可

提交内容属于任意原生 CUDA/C++ 代码。请只在可信网络中为可信用户运行本服务。
公开或多用户部署必须使用经过加固的执行沙箱，对进程、文件系统、网络和资源进行隔离。

上游题目内容保留在独立的 Git submodule 中，并受其 CC BY-NC-ND 4.0 许可证约束。
本项目只读取这些文件，不修改或重新发布它们。
