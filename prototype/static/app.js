const state = {
  workflows: [],
  workflow: null,
  selectedTaskId: null,
  pollTimer: null,
  pollingBusy: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const SAMPLE_SPECS = {
  xhs: "我要做一个类似小红书的内容社区产品，支持图文笔记发布、视频浏览、搜索推荐、关注互动和电商闭环。用户可以在移动端浏览内容、发布笔记、关注创作者并完成商品购买。",
  wechat: "我要做一个类似微信的即时通讯产品，支持即时通讯、通讯录与关系链、朋友圈、支付和小程序。重点保证消息实时性、关系链安全、移动端体验和平台生态。",
  generic: "我要做一个通用企业协作产品，支持用户与权限、核心业务、搜索与推荐、通知与消息，以及后台管理能力。",
};

const ROLE_LABELS = { PM: "PM", "架构": "架构", "后端": "后端", "前端": "前端", QA: "QA", DevOps: "DevOps" };
const ROLE_CLASS = { PM: "pm", "架构": "arch", "后端": "backend", "前端": "frontend", QA: "qa", DevOps: "devops" };
const STATUS_LABELS = {
  GENERATED: "已生成",
  RUNNING: "运行中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  FAILED: "失败",
  PENDING: "等待",
  SUCCEEDED: "已完成",
  "待生成": "待生成",
};
const EVENT_LABELS = {
  PM_ANALYZED: "PM 分析完成",
  TASKS_GENERATED: "任务生成",
  SCHEDULE_CREATED: "编排生成",
  WORKFLOW_STARTED: "开始执行",
  TASKS_STARTED: "任务开始",
  TASKS_COMPLETED: "任务完成",
  WORKFLOW_COMPLETED: "工作流完成",
  WORKFLOW_CANCELLED: "工作流取消",
  WORKFLOW_RESET: "工作流重置",
  WORKFLOW_FAILED: "工作流失败",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function showToast(message, kind = "info") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.background = kind === "error" ? "#9f2f35" : "#10233f";
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function formatTime(iso) {
  if (!iso) return "--:--";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--:--" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function statusClass(status) {
  return String(status || "").toLowerCase().replaceAll("_", "-");
}

function setBadge(el, status) {
  if (!el) return;
  el.textContent = STATUS_LABELS[status] || status || "—";
  el.className = `badge ${statusClass(status)}`;
}

function showView(view) {
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
  $$(".nav-item[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  $$(".tab[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  if (view === "schedule") renderSchedule();
  if (view === "tasks") renderTaskTable();
}

function featureList(workflow) {
  const values = new Set();
  for (const task of workflow?.tasks || []) {
    if (task.name.endsWith("后端服务")) values.add(task.name.slice(0, -4));
    if (task.name.endsWith("前端体验")) values.add(task.name.slice(0, -4));
  }
  return Array.from(values);
}

function renderTopbar() {
  const wf = state.workflow;
  $("#top-workflow-title").textContent = wf?.title || "通用软件工程工作流";
  setBadge($("#workflow-status"), wf?.status || "待生成");
  $("#pm-model-badge").textContent = wf?.pm_model || "deepseek-reasoner";
}

function renderSpecSummary() {
  const wf = state.workflow;
  const empty = !wf;
  $("#pm-empty").classList.toggle("hidden", !empty);
  $("#pm-summary").classList.toggle("hidden", empty);
  if (!wf) {
    $("#workflow-count-badge").textContent = `${state.workflows.length} 个`;
    return;
  }
  const features = featureList(wf);
  $("#pm-summary-text").textContent = wf.summary;
  $("#stat-features").textContent = features.length;
  $("#stat-tasks").textContent = wf.stats.task_count;
  $("#stat-hours").textContent = `${wf.stats.total_hours}h`;
  $("#stat-days").textContent = `${Math.ceil(wf.stats.max_day)}天`;
  $("#feature-tags").innerHTML = features.map((feature) => `<span class="feature-tag">${escapeHtml(feature)}</span>`).join("");
  $("#workflow-count-badge").textContent = `${state.workflows.length} 个`;
}

function renderRecentWorkflows() {
  const root = $("#recent-workflows");
  if (!state.workflows.length) {
    root.innerHTML = '<div class="empty-note">还没有工作流，先输入一个设计规格。</div>';
    return;
  }
  root.innerHTML = state.workflows.map((wf) => `
    <button class="workflow-card ${state.workflow?.id === wf.id ? "active" : ""}" data-workflow-id="${escapeHtml(wf.id)}">
      <div class="workflow-card-head"><strong>${escapeHtml(wf.title)}</strong><span class="badge ${statusClass(wf.status)}">${STATUS_LABELS[wf.status] || wf.status}</span></div>
      <div class="workflow-card-meta"><span>${escapeHtml(wf.product_name)}</span><span>${wf.task_count} 个任务</span><span>${wf.total_hours} 人时</span><span>${Math.ceil(wf.max_day)} 天</span></div>
      <small>${formatTime(wf.created_at)}</small>
    </button>
  `).join("");
}

function taskStatusBadge(status) {
  return `<span class="badge ${statusClass(status)}">${STATUS_LABELS[status] || status}</span>`;
}

function renderTaskTree() {
  const root = $("#task-tree");
  const wf = state.workflow;
  if (!wf) {
    root.innerHTML = '<div class="empty-note">生成工作流后会显示任务分解树。</div>';
    return;
  }
  const phases = [];
  for (const task of wf.tasks) {
    if (!phases.includes(task.phase)) phases.push(task.phase);
  }
  const phaseHtml = phases.map((phase, phaseIndex) => {
    const phaseTasks = wf.tasks.filter((task) => task.phase === phase);
    const phaseHours = phaseTasks.reduce((sum, task) => sum + task.estimate_hours, 0);
    const taskHtml = phaseTasks.map((task) => `
      <button class="wbs-task ${state.selectedTaskId === task.id ? "selected" : ""}" data-task-id="${escapeHtml(task.id)}">
        <span class="wbs-task-id">${escapeHtml(task.task_key)}</span>
        <span class="wbs-task-copy"><strong>${escapeHtml(task.name)}</strong><small><span class="role-pill role-${ROLE_CLASS[task.role] || "default"}">${escapeHtml(ROLE_LABELS[task.role] || task.role)}</span><span>${escapeHtml(task.priority)}</span><span>${task.estimate_hours}h</span><span>依赖 ${escapeHtml(task.dependencies.join("、") || "无")}</span></small></span>
        <span class="badge ${statusClass(task.status)}">${STATUS_LABELS[task.status] || task.status}</span>
      </button>
    `).join("");
    return `<section class="wbs-phase">
      <div class="wbs-phase-head"><span class="wbs-phase-index">${String(phaseIndex + 1).padStart(2, "0")}</span><strong>${escapeHtml(phase)}</strong><span>${phaseTasks.length} 个任务 · ${phaseHours}h</span></div>
      <div class="wbs-task-list">${taskHtml}</div>
    </section>`;
  }).join("");
  root.innerHTML = `<div class="wbs-root"><div class="wbs-root-label">产品主干</div><strong>${escapeHtml(wf.title)}</strong><span>${escapeHtml(wf.product_name)} · ${wf.stats.task_count} 个任务 · ${wf.stats.total_hours} 人时 · ${Math.ceil(wf.stats.max_day)} 天</span></div>${phaseHtml}`;
}

function renderTaskTable() {
  const wf = state.workflow;
  const body = $("#task-table-body");
  $("#task-view-subtitle").textContent = wf ? `${wf.title} · PM Agent 生成 ${wf.stats.task_count} 个任务` : "从设计规格提取功能域，并生成带依赖、角色和工时的开发任务。";
  if (!wf) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty">尚未生成任务。</td></tr>';
    renderTaskTree();
    return;
  }
  body.innerHTML = wf.tasks.map((task) => `
    <tr class="task-row ${state.selectedTaskId === task.id ? "selected" : ""}" data-task-id="${escapeHtml(task.id)}">
      <td><b>${escapeHtml(task.task_key)}</b></td>
      <td><strong>${escapeHtml(task.name)}</strong></td>
      <td><span class="role-pill role-${ROLE_CLASS[task.role] || "default"}">${escapeHtml(ROLE_LABELS[task.role] || task.role)}</span></td>
      <td>${escapeHtml(task.phase)}</td>
      <td><span class="priority ${task.priority === "P0" ? "p0" : "p1"}">${escapeHtml(task.priority)}</span></td>
      <td>${task.estimate_hours}h</td>
      <td>${escapeHtml(task.dependencies.join("、") || "无")}</td>
      <td>${taskStatusBadge(task.status)}</td>
    </tr>
  `).join("");
  renderTaskTree();
}

function selectedTask() {
  return state.workflow?.tasks?.find((task) => task.id === state.selectedTaskId) || null;
}

function renderInspector() {
  const task = selectedTask();
  if (!task) {
    $("#inspector-task-name").textContent = "选择一个任务";
    $("#inspector-task-status").textContent = "—";
    $("#inspector-task-status").className = "badge";
    $("#inspector-task-body").innerHTML = '<div class="empty-note">点击甘特图中的任务查看详情。</div>';
    return;
  }
  $("#inspector-task-name").textContent = `${task.task_key} · ${task.name}`;
  setBadge($("#inspector-task-status"), task.status);
  $("#inspector-task-body").innerHTML = `
    <div class="inspector-detail"><span>角色</span><strong>${escapeHtml(ROLE_LABELS[task.role] || task.role)}</strong></div>
    <div class="inspector-detail"><span>阶段</span><strong>${escapeHtml(task.phase)}</strong></div>
    <div class="inspector-detail"><span>优先级</span><strong>${escapeHtml(task.priority)}</strong></div>
    <div class="inspector-detail"><span>估算工时</span><strong>${task.estimate_hours} 人时</strong></div>
    <div class="inspector-detail"><span>排期</span><strong>第 ${task.start_day + 1} – ${task.end_day} 天</strong></div>
    <div class="inspector-detail"><span>依赖任务</span><strong>${escapeHtml(task.dependencies.join("、") || "无")}</strong></div>
    <div class="inspector-note">该任务由 PM Agent 从设计规格中拆分，由编排器按依赖关系生成排期。</div>
  `;
}

function renderGantt() {
  const root = $("#gantt-root");
  const wf = state.workflow;
  if (!wf) {
    root.innerHTML = '<div class="empty-note">生成工作流后会显示任务排期。</div>';
    return;
  }
  const maxDay = Math.max(1, Math.ceil(wf.stats.max_day));
  const step = maxDay > 14 ? 2 : 1;
  const ticks = [];
  for (let day = 0; day <= maxDay; day += step) ticks.push(day);
  const axis = `<div class="gantt-axis"><div></div><div class="gantt-ticks">${ticks.map((day) => `<span style="left:${(day / maxDay) * 100}%">D${day + 1}</span>`).join("")}</div></div>`;
  const rows = wf.tasks.map((task) => {
    const left = (task.start_day / maxDay) * 100;
    const width = Math.max(2, ((task.end_day - task.start_day) / maxDay) * 100);
    return `<div class="gantt-row ${state.selectedTaskId === task.id ? "selected" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="gantt-label"><b>${escapeHtml(task.task_key)}</b><span>${escapeHtml(task.name)}</span></div>
      <div class="gantt-track"><div class="gantt-bar role-${ROLE_CLASS[task.role] || "default"} status-${statusClass(task.status)}" style="left:${left}%;width:${width}%" title="${escapeHtml(task.name)} · ${task.estimate_hours}h"><span>${escapeHtml(task.task_key)} · ${task.estimate_hours}h</span></div></div>
    </div>`;
  }).join("");
  root.innerHTML = axis + rows;
}

function renderTimeline() {
  const events = state.workflow?.events || [];
  $("#event-count").textContent = `${events.length} 条`;
  const timeline = $("#timeline");
  if (!events.length) {
    timeline.className = "timeline empty";
    timeline.textContent = "生成并执行工作流后，这里会显示 PM Agent 和编排器事件。";
    return;
  }
  timeline.className = "timeline";
  timeline.innerHTML = events.map((event) => `
    <div class="timeline-item"><div class="timeline-time">${formatTime(event.created_at)}</div><div class="timeline-dot ${event.level || "info"}"></div><div class="timeline-copy"><strong>${escapeHtml(event.message)}</strong><small>${escapeHtml(EVENT_LABELS[event.type] || event.type)}</small></div></div>
  `).join("");
}

function renderSchedule() {
  if (!state.workflow) {
    $("#schedule-status").textContent = "待生成";
    $("#schedule-status").className = "badge";
    $("#gantt-root").innerHTML = '<div class="empty-note">生成工作流后会显示任务排期。</div>';
    renderInspector();
    renderTimeline();
    return;
  }
  setBadge($("#schedule-status"), state.workflow.status);
  renderGantt();
  renderInspector();
  renderTimeline();
  const running = state.workflow.status === "RUNNING";
  $("#run-btn").disabled = running;
  $("#cancel-run-btn").disabled = !running;
  $("#reset-run-btn").disabled = running;
}

function renderAll() {
  renderTopbar();
  renderSpecSummary();
  renderRecentWorkflows();
  renderTaskTable();
  renderSchedule();
}

async function loadWorkflows() {
  const payload = await api("/api/workflows");
  state.workflows = payload.items || [];
}

async function loadWorkflow(workflowId) {
  state.workflow = await api(`/api/workflows/${encodeURIComponent(workflowId)}`);
  state.selectedTaskId = state.workflow.tasks?.[0]?.id || null;
  renderAll();
}

async function generateWorkflow() {
  const specText = $("#spec-input").value.trim();
  if (!specText) {
    showToast("请先输入设计规格", "error");
    return;
  }
  try {
    state.workflow = await api("/api/workflows/generate", { method: "POST", body: JSON.stringify({ spec_text: specText }) });
    state.selectedTaskId = state.workflow.tasks?.[0]?.id || null;
    await loadWorkflows();
    renderAll();
    showView("tasks");
    showToast("PM Agent 已完成任务分解");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.workflow?.id || state.pollingBusy) return;
    if (state.workflow.status !== "RUNNING") {
      stopPolling();
      return;
    }
    state.pollingBusy = true;
    try {
      state.workflow = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}`);
      await loadWorkflows();
      renderAll();
    } catch (error) {
      showToast(error.message, "error");
      stopPolling();
    } finally {
      state.pollingBusy = false;
    }
  }, 700);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function runWorkflow() {
  if (!state.workflow) {
    showToast("请先生成工作流", "error");
    return;
  }
  try {
    state.workflow = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}/run`, { method: "POST" });
    await loadWorkflows();
    showView("schedule");
    renderAll();
    startPolling();
    showToast("编排执行已启动");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function cancelWorkflow() {
  if (!state.workflow) return;
  try {
    state.workflow = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}/cancel`, { method: "POST" });
    stopPolling();
    await loadWorkflows();
    renderAll();
    showToast("编排执行已取消");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function resetWorkflow() {
  if (!state.workflow) return;
  try {
    state.workflow = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}/reset`, { method: "POST" });
    stopPolling();
    await loadWorkflows();
    renderAll();
    showToast("已重置编排状态");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function bootstrap() {
  try {
    await loadWorkflows();
    if (state.workflows.length) {
      await loadWorkflow(state.workflows[0].id);
    } else {
      renderAll();
    }
    $("#spec-input").value = SAMPLE_SPECS.xhs;
    showView("spec");
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) showView(viewButton.dataset.view);
  const sample = event.target.closest("[data-sample]");
  if (sample) {
    $("#spec-input").value = SAMPLE_SPECS[sample.dataset.sample] || "";
    $("#spec-input").focus();
  }
  const workflowCard = event.target.closest("[data-workflow-id]");
  if (workflowCard) {
    await loadWorkflow(workflowCard.dataset.workflowId);
    showView("tasks");
  }
  const taskRow = event.target.closest("[data-task-id]");
  if (taskRow) {
    state.selectedTaskId = taskRow.dataset.taskId;
    renderTaskTable();
    renderGantt();
    renderInspector();
  }
});

$("#generate-btn").addEventListener("click", generateWorkflow);
$("#clear-spec-btn").addEventListener("click", () => { $("#spec-input").value = ""; $("#spec-input").focus(); });
$("#new-workflow-btn").addEventListener("click", () => { showView("spec"); $("#spec-input").focus(); });
$("#run-btn").addEventListener("click", runWorkflow);
$("#cancel-run-btn").addEventListener("click", cancelWorkflow);
$("#reset-run-btn").addEventListener("click", resetWorkflow);

bootstrap();
