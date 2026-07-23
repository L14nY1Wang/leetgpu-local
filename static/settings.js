const state = {
  challenges: [],
  config: { tolerances: {}, float32MatmulPrecision: {} },
  view: "table",
  query: "",
};
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（状态码 ${response.status}）`);
  return data;
}

function setMessage(message, type = "") {
  $("#settingsMessage").textContent = message;
  $("#settingsMessage").className = `settings-message ${type}`;
  $("#configStatus").textContent = message || "配置已载入";
  $("#configDot").className = type === "error" ? "offline" : "online";
}

function configuredIds() {
  return new Set([
    ...Object.keys(state.config.tolerances || {}),
    ...Object.keys(state.config.float32MatmulPrecision || {}),
  ]);
}

function allChallenges() {
  const known = new Map(state.challenges.map((challenge) => [challenge.id, challenge]));
  for (const id of configuredIds()) {
    if (!known.has(id)) known.set(id, { id, number: "--", title: "未在题库中找到" });
  }
  return [...known.values()].sort((a, b) => Number(a.number) - Number(b.number));
}

function countOverrides() {
  $("#overrideCount").textContent = `${configuredIds().size} 项覆盖`;
}

function renderRows() {
  const query = state.query.trim().toLowerCase();
  const rows = allChallenges().filter((challenge) =>
    `${challenge.number} ${challenge.id} ${challenge.title}`.toLowerCase().includes(query)
  );
  $("#settingsRows").innerHTML = rows.length ? rows.map((challenge) => {
    const tolerance = state.config.tolerances[challenge.id] || {};
    const precision = state.config.float32MatmulPrecision[challenge.id] || "";
    const active = Object.keys(tolerance).length > 0 || precision;
    return `<tr data-id="${escapeHtml(challenge.id)}">
      <td><strong>${String(challenge.number).padStart(3, "0")} / ${escapeHtml(challenge.title)}</strong><code>${escapeHtml(challenge.id)}</code></td>
      <td><input data-field="atol" type="number" min="0" step="any" inputmode="decimal" value="${tolerance.atol ?? ""}" placeholder="默认"></td>
      <td><input data-field="rtol" type="number" min="0" step="any" inputmode="decimal" value="${tolerance.rtol ?? ""}" placeholder="默认"></td>
      <td><select data-field="precision"><option value="">默认</option>${["highest", "high", "medium"].map((value) => `<option value="${value}" ${precision === value ? "selected" : ""}>${value}</option>`).join("")}</select></td>
      <td><span class="row-state ${active ? "active" : ""}">${active ? "已覆盖" : "默认"}</span></td>
    </tr>`;
  }).join("") : '<tr><td colspan="5" class="settings-empty">没有匹配的题目。</td></tr>';
}

function updateConfigFromRow(row, field, rawValue) {
  const id = row.dataset.id;
  if (field === "precision") {
    if (rawValue) state.config.float32MatmulPrecision[id] = rawValue;
    else delete state.config.float32MatmulPrecision[id];
  } else {
    const tolerance = state.config.tolerances[id] || {};
    if (rawValue === "") delete tolerance[field];
    else tolerance[field] = Number(rawValue);
    if (Object.keys(tolerance).length) state.config.tolerances[id] = tolerance;
    else delete state.config.tolerances[id];
  }
  const active = configuredIds().has(id);
  const badge = row.querySelector(".row-state");
  badge.textContent = active ? "已覆盖" : "默认";
  badge.classList.toggle("active", active);
  countOverrides();
  setMessage("有未保存的修改");
}

function syncRawEditor() {
  $("#jsonEditor").value = `${JSON.stringify(state.config, null, 2)}\n`;
}

function readRawEditor() {
  try {
    const parsed = JSON.parse($("#jsonEditor").value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("根节点必须是 JSON 对象");
    state.config = parsed;
    state.config.tolerances ||= {};
    state.config.float32MatmulPrecision ||= {};
    return true;
  } catch (error) {
    setMessage(`JSON 无效：${error.message}`, "error");
    return false;
  }
}

function switchView(view) {
  if (state.view === "json" && view === "table" && !readRawEditor()) return;
  if (view === "json") syncRawEditor();
  state.view = view;
  $("#tableView").hidden = view !== "table";
  $("#jsonView").hidden = view !== "json";
  $("#tableTab").classList.toggle("active", view === "table");
  $("#jsonTab").classList.toggle("active", view === "json");
  $("#tableTab").setAttribute("aria-selected", String(view === "table"));
  $("#jsonTab").setAttribute("aria-selected", String(view === "json"));
  if (view === "table") { renderRows(); countOverrides(); }
}

async function loadSettings() {
  $("#reloadButton").disabled = true;
  try {
    const [config, challenges] = await Promise.all([
      api("/api/judge-overrides"), api("/api/challenges"),
    ]);
    state.config = config;
    state.challenges = challenges;
    renderRows();
    syncRawEditor();
    countOverrides();
    setMessage("配置已载入");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    $("#reloadButton").disabled = false;
  }
}

async function saveSettings() {
  if (state.view === "json" && !readRawEditor()) return;
  $("#saveButton").disabled = true;
  try {
    const result = await api("/api/judge-overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.config),
    });
    state.config = result.config;
    renderRows();
    syncRawEditor();
    countOverrides();
    setMessage("配置已保存，下次判题立即生效", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    $("#saveButton").disabled = false;
  }
}

$("#settingsRows").addEventListener("input", (event) => {
  if (!event.target.dataset.field || event.target.dataset.field === "precision") return;
  updateConfigFromRow(event.target.closest("tr"), event.target.dataset.field, event.target.value);
});
$("#settingsRows").addEventListener("change", (event) => {
  if (event.target.dataset.field === "precision") updateConfigFromRow(event.target.closest("tr"), "precision", event.target.value);
});
$("#settingsSearch").addEventListener("input", (event) => { state.query = event.target.value; renderRows(); });
$("#jsonEditor").addEventListener("input", () => setMessage("有未保存的修改"));
$("#tableTab").addEventListener("click", () => switchView("table"));
$("#jsonTab").addEventListener("click", () => switchView("json"));
$("#reloadButton").addEventListener("click", loadSettings);
$("#saveButton").addEventListener("click", saveSettings);
loadSettings();
