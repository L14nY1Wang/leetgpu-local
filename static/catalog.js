const state = { challenges: [], filter: "All", query: "" };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const difficultyLabels = { All: "全部", Easy: "简单", Medium: "中等", Hard: "困难" };
const categoryLabels = {
  "AI Models": "AI 模型", "Linear Algebra": "线性代数", Vision: "计算机视觉",
  "Neural Ops": "神经网络算子", "Parallel Algorithms": "并行算法",
  Algorithms: "算法", "GPU Foundations": "GPU 基础"
};
const languageLabels = { cuda: "CUDA", pytorch: "PyTorch", triton: "Triton", cutedsl: "CuTeDSL", tilelang: "TileLang" };

const storage = {
  solved() {
    try { return JSON.parse(localStorage.getItem("kernel-solved") || "[]"); }
    catch { return []; }
  }
};

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（状态码 ${response.status}）`);
  return data;
}

function renderFilters() {
  const values = ["All", "Easy", "Medium", "Hard"];
  $("#filterButtons").innerHTML = values.map((value) =>
    `<button class="${state.filter === value ? "active" : ""}" data-filter="${value}">${difficultyLabels[value]}</button>`
  ).join("");
  $("#filterButtons").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    renderFilters();
    renderCards();
  }));
}

function renderCards() {
  const solved = storage.solved();
  const query = state.query.toLowerCase();
  const visible = state.challenges.filter((item) => {
    const matchesFilter = state.filter === "All" || item.difficulty === state.filter;
    const haystack = `${item.number} ${item.title} ${item.summary} ${item.category}`.toLowerCase();
    return matchesFilter && haystack.includes(query);
  });
  $("#resultCount").textContent = `${visible.length} 道题目`;
  $("#progressText").textContent = `已完成 ${solved.filter((id) => state.challenges.some((item) => item.id === id)).length} / ${state.challenges.length}`;
  $("#challengeGrid").innerHTML = visible.length ? visible.map((item) => `
    <a class="challenge-card ${solved.includes(item.id) ? "solved" : ""}" href="/challenge/${encodeURIComponent(item.id)}">
      <span class="card-number">${String(item.number).padStart(3, "0")}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <div class="language-pips">${item.languages.map((language) => `<span>${escapeHtml(languageLabels[language] || language)}</span>`).join("")}</div>
      <div class="card-meta"><span>${escapeHtml(categoryLabels[item.category] || item.category)}</span><span>${escapeHtml(difficultyLabels[item.difficulty] || item.difficulty)} →</span></div>
    </a>`).join("") : '<div class="loading">没有找到符合条件的题目。</div>';
}

async function syncRepository() {
  const button = $("#syncButton");
  button.disabled = true;
  $("#syncMessage").textContent = "正在拉取上游仓库修改...";
  try {
    const result = await api("/api/upstream/sync", { method: "POST" });
    $("#syncMessage").textContent = `同步完成，当前共有 ${result.count} 道题目。`;
    await loadManifest();
  } catch (error) {
    $("#syncMessage").textContent = error.message;
  } finally { button.disabled = false; }
}

async function loadManifest() {
  const [health, upstream, challenges] = await Promise.all([
    api("/api/health"), api("/api/upstream"), api("/api/challenges")
  ]);
  state.challenges = challenges;
  $("#serverDot").className = health.ready ? "online" : "offline";
  $("#serverStatus").textContent = health.ready ? "官方判题器已就绪" : health.gpu ? "需要安装判题依赖" : "GPU 不可用";
  $("#manifestCount").textContent = upstream.count;
  $("#manifestCommit").textContent = upstream.commit || "不可用";
  renderFilters();
  renderCards();
}

$("#searchInput").addEventListener("input", (event) => { state.query = event.target.value; renderCards(); });
$("#syncButton").addEventListener("click", syncRepository);
loadManifest().catch((error) => { $("#challengeGrid").innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`; });
