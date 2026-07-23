const state = { id: decodeURIComponent(location.pathname.split("/").filter(Boolean).at(-1) || ""), challenge: null, challenges: [], health: null, language: "cuda", running: false };
const $ = (selector) => document.querySelector(selector);
const extensions = { cuda: "cu", pytorch: "py", triton: "py", cutedsl: "py", tilelang: "py" };
const languageLabels = { cuda: "CUDA", pytorch: "PyTorch", triton: "Triton", cutedsl: "CuTeDSL", tilelang: "TileLang" };
const difficultyLabels = { Easy: "简单", Medium: "中等", Hard: "困难" };
const categoryLabels = {
  "AI Models": "AI 模型", "Linear Algebra": "线性代数", Vision: "计算机视觉",
  "Neural Ops": "神经网络算子", "Parallel Algorithms": "并行算法",
  Algorithms: "算法", "GPU Foundations": "GPU 基础"
};
const stageLabels = { environment: "运行环境", compile: "编译", run: "运行", complete: "完成" };

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（状态码 ${response.status}）`);
  return data;
}

const drafts = {
  key() { return `kernel-draft:${state.id}:${state.language}`; },
  get() { return localStorage.getItem(this.key()); },
  set(value) { localStorage.setItem(this.key(), value); },
  markSolved() {
    let solved;
    try { solved = JSON.parse(localStorage.getItem("kernel-solved") || "[]"); } catch { solved = []; }
    localStorage.setItem("kernel-solved", JSON.stringify([...new Set([...solved, state.id])]));
  }
};

const workspaceSizing = {
  problemKey: "kernel-layout:problem-width",
  consoleKey: "kernel-layout:console-height",
  shell: null,
  codePane: null,
  problemDivider: null,
  consoleDivider: null,

  clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  },

  setProblemWidth(value, persist = false) {
    if (matchMedia("(max-width: 980px)").matches) return;
    const shellWidth = this.shell.getBoundingClientRect().width;
    const minimum = Math.min(320, shellWidth * 0.4);
    const maximum = Math.max(minimum, shellWidth - 466);
    const width = this.clamp(value, minimum, maximum);
    this.shell.style.setProperty("--problem-width", `${width}px`);
    this.problemDivider.setAttribute("aria-valuenow", Math.round(width / shellWidth * 100));
    if (persist) localStorage.setItem(this.problemKey, String(Math.round(width)));
  },

  setConsoleHeight(value, persist = false) {
    const paneHeight = this.codePane.getBoundingClientRect().height;
    const maximum = Math.max(120, paneHeight - 284);
    const height = this.clamp(value, 120, maximum);
    this.codePane.style.setProperty("--console-height", `${height}px`);
    this.consoleDivider.setAttribute("aria-valuenow", Math.round(height / paneHeight * 100));
    if (persist) localStorage.setItem(this.consoleKey, String(Math.round(height)));
  },

  bindPointer(handle, orientation) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (orientation === "vertical" && matchMedia("(max-width: 980px)").matches)) return;
      event.preventDefault();
      const startPosition = orientation === "vertical" ? event.clientX : event.clientY;
      const startSize = orientation === "vertical"
        ? document.querySelector(".problem-pane").getBoundingClientRect().width
        : document.querySelector(".console").getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add(orientation === "vertical" ? "resizing-columns" : "resizing-rows");

      const move = (moveEvent) => {
        const delta = orientation === "vertical"
          ? moveEvent.clientX - startPosition
          : startPosition - moveEvent.clientY;
        if (orientation === "vertical") this.setProblemWidth(startSize + delta);
        else this.setConsoleHeight(startSize + delta);
      };
      const stop = () => {
        handle.classList.remove("dragging");
        document.body.classList.remove("resizing-columns", "resizing-rows");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        if (orientation === "vertical") {
          this.setProblemWidth(document.querySelector(".problem-pane").getBoundingClientRect().width, true);
        } else {
          this.setConsoleHeight(document.querySelector(".console").getBoundingClientRect().height, true);
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  },

  bindKeyboard(handle, orientation) {
    handle.addEventListener("keydown", (event) => {
      const amount = event.shiftKey ? 48 : 16;
      if (orientation === "vertical" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const width = document.querySelector(".problem-pane").getBoundingClientRect().width;
        this.setProblemWidth(width + (event.key === "ArrowRight" ? amount : -amount), true);
      }
      if (orientation === "horizontal" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const height = document.querySelector(".console").getBoundingClientRect().height;
        this.setConsoleHeight(height + (event.key === "ArrowUp" ? amount : -amount), true);
      }
    });
    handle.addEventListener("dblclick", () => {
      if (orientation === "vertical") {
        localStorage.removeItem(this.problemKey);
        this.shell.style.removeProperty("--problem-width");
        this.problemDivider.setAttribute("aria-valuenow", "42");
      } else {
        localStorage.removeItem(this.consoleKey);
        this.codePane.style.removeProperty("--console-height");
        this.consoleDivider.setAttribute("aria-valuenow", "30");
      }
    });
  },

  initialize() {
    this.shell = document.querySelector(".workspace-shell");
    this.codePane = document.querySelector(".code-pane");
    this.problemDivider = $("#workspaceDivider");
    this.consoleDivider = $("#consoleDivider");
    this.bindPointer(this.problemDivider, "vertical");
    this.bindPointer(this.consoleDivider, "horizontal");
    this.bindKeyboard(this.problemDivider, "vertical");
    this.bindKeyboard(this.consoleDivider, "horizontal");

    const problemWidth = Number(localStorage.getItem(this.problemKey));
    const consoleHeight = Number(localStorage.getItem(this.consoleKey));
    if (problemWidth > 0) this.setProblemWidth(problemWidth);
    if (consoleHeight > 0) this.setConsoleHeight(consoleHeight);
    window.addEventListener("resize", () => {
      const currentProblemWidth = document.querySelector(".problem-pane").getBoundingClientRect().width;
      const currentConsoleHeight = document.querySelector(".console").getBoundingClientRect().height;
      this.setProblemWidth(currentProblemWidth);
      this.setConsoleHeight(currentConsoleHeight);
    });
  },
};

function sanitize(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  template.content.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => [...node.attributes].forEach((attribute) => {
    if (attribute.name.startsWith("on") || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
  }));
  return template.innerHTML;
}

function showOutput(message, passed) {
  $("#consoleOutput").textContent = message;
  $("#consoleOutput").className = passed === undefined ? "" : passed ? "success" : "failure";
  if (passed !== undefined) $("#runState").textContent = passed ? "全部测试通过" : "测试未通过";
}

function renderNavigation() {
  const index = state.challenges.findIndex((item) => item.id === state.id);
  $("#workspaceCounter").textContent = `${index + 1} / ${state.challenges.length}`;
  const previous = state.challenges[index - 1];
  const next = state.challenges[index + 1];
  $("#previousLink").href = previous ? `/challenge/${encodeURIComponent(previous.id)}` : "/";
  $("#nextLink").href = next ? `/challenge/${encodeURIComponent(next.id)}` : "/";
}

function renderLanguageButtons() {
  $("#languageButtons").innerHTML = state.challenge.languages.map((language) =>
    `<button class="${language === state.language ? "active" : ""}" data-language="${language}">${languageLabels[language] || language}</button>`
  ).join("");
  $("#languageButtons").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => loadChallenge(button.dataset.language)));
}

async function loadChallenge(language) {
  const challenge = await api(`/api/challenges/${encodeURIComponent(state.id)}?language=${encodeURIComponent(language || "cuda")}`);
  state.challenge = challenge;
  state.language = challenge.language;
  document.title = `${challenge.number}. ${challenge.title} / Kernelyard 做题工作台`;
  $("#challengeNumber").textContent = `题目 ${String(challenge.number).padStart(3, "0")}`;
  $("#difficultyBadge").textContent = difficultyLabels[challenge.difficulty] || challenge.difficulty;
  $("#difficultyBadge").className = `difficulty ${challenge.difficulty}`;
  $("#problemTitle").textContent = challenge.title;
  $("#problemCategory").textContent = categoryLabels[challenge.category] || challenge.category;
  $("#sourceLink").href = challenge.sourceUrl;
  $("#problemBody").innerHTML = sanitize(challenge.descriptionHtml);
  if (typeof renderMathInElement === "function") {
    renderMathInElement($("#problemBody"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false
    });
  }
  $("#signature").textContent = challenge.signature;
  $("#fileName").textContent = `solution.${extensions[state.language] || "txt"}`;
  KernelEditor.setLanguage(state.language, challenge.signature);
  KernelEditor.setValue(drafts.get() || challenge.starter);
  renderLanguageButtons();
  const runnable = Boolean(state.health?.languages?.[state.language]);
  $("#runButton").disabled = !runnable;
  $("#submitButton").disabled = !runnable;
  const languageName = languageLabels[state.language] || state.language;
  showOutput(runnable ? `// ${languageName} 初始代码已加载，可以运行官方测试。` : `// 已加载 ${languageName} 初始代码，可在此编辑。\n// 当前服务器尚未安装该语言的运行依赖。`, undefined);
}

async function execute(submit) {
  if (!state.challenge || !state.health?.languages?.[state.language] || state.running) return;
  state.running = true;
  $("#runButton").disabled = true; $("#submitButton").disabled = true;
  $("#runState").textContent = submit ? "正在运行全部测试" : "正在运行样例";
  showOutput("$ nvcc -O3 --shared solution.cu\n正在编译并加载官方题目测试...", undefined);
  try {
    const result = await api("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: state.id, language: state.language, source: KernelEditor.getValue(), submit })
    });
    showOutput(`${result.passed ? "✓" : "×"} ${stageLabels[result.stage] || result.stage}\n\n${result.output}`, result.passed);
    if (result.passed && submit) drafts.markSolved();
  } catch (error) { showOutput(error.message, false); }
  finally { state.running = false; $("#runButton").disabled = false; $("#submitButton").disabled = false; }
}

async function init() {
  try {
    const [health, challenges] = await Promise.all([api("/api/health"), api("/api/challenges")]);
    state.health = health;
    state.challenges = challenges;
    if (!challenges.some((item) => item.id === state.id)) throw new Error("在上游题库中找不到该题目。");
    $("#serverDot").className = health.ready ? "online" : "offline";
    const readyCount = Object.values(health.languages || {}).filter(Boolean).length;
    $("#serverStatus").textContent = health.ready ? "五种判题器均已就绪" : health.gpu ? `${readyCount} / 5 种判题器可用` : "GPU 不可用";
    renderNavigation();
    await loadChallenge("cuda");
  } catch (error) { showOutput(error.message, false); $("#problemTitle").textContent = "无法加载题目"; }
}

KernelEditor.initialize({
  parent: $("#codeEditor"),
  onChange: (value) => { if (state.challenge) drafts.set(value); },
  onRun: () => execute(false),
});
workspaceSizing.initialize();
$("#resetButton").addEventListener("click", () => { if (!state.challenge) return; KernelEditor.setValue(state.challenge.starter); KernelEditor.focus(); });
$("#runButton").addEventListener("click", () => execute(false));
$("#submitButton").addEventListener("click", () => execute(true));
init();
