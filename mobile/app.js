import { CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { LocalNotifications } from "@capacitor/local-notifications";
import { createPlayground } from "./playground.js";
import { BUNDLED_ARK_KEY, BUNDLED_ECHO_TOKEN } from "./private-config.js";

const sample = `我：你到家了吗？
阿泽：刚到，今天路上堵得离谱，我差点在车上睡着
我：吃饭没
阿泽：还没呢，你又要催我了是吧哈哈
我：少贫，快去吃
阿泽：知道啦知道啦，冰箱里还有昨天的番茄，我煮个面
我：你不是说今天要少吃面吗
阿泽：计划赶不上肚子饿嘛，明天再当自律的人
我：你每次都说明天
阿泽：那说明我对明天一直很有信心，逻辑没问题吧
我：歪理一套一套的
阿泽：主要是想逗你笑，你今天听起来有点不开心
我：工作上出了点问题
阿泽：严重吗？你慢慢说，我先听，不急着给你讲大道理
我：方案被退回来了，改了好几天
阿泽：那肯定很难受，但被退的是方案，不是你这个人，别混在一起骂自己
我：可我觉得自己做得很差
阿泽：不许这么说，你上周熬夜做的那版我看过，认真得我都挑不出错
我：你又不懂这个
阿泽：我是不懂专业，但我懂你啊，你不是会随便糊弄事情的人
我：好吧，被你说得舒服一点了
阿泽：这才对嘛，今晚先别硬撑，吃点东西，脑子休息了才有新办法
我：那你陪我聊会儿
阿泽：行啊，我面都可以晚点煮，你想吐槽谁我就站哪边
我：你今天拍照了吗
阿泽：拍了，傍晚那片云特别像橘子汽水，等会儿发你
我：你怎么什么都能想到吃的
阿泽：因为人生已经够复杂了，吃的简单又诚实
我：周末天气好像不错
阿泽：那去江边走走？我带相机，你负责提醒我别光顾着拍忘了看路
我：上次差点撞树的人是谁
阿泽：咳，那是树突然出现在我的艺术道路上
我：哈哈哈哈
阿泽：终于笑了，今日任务完成一半
我：另一半是什么
阿泽：看着你早点睡，别又两点钟偷偷给我发“还醒着吗”
我：如果我真的睡不着呢
阿泽：那就发，我手机不静音。你不用每次都一个人扛着
我：你这样会把我惯坏
阿泽：坏一点也没事，反正我认得出来
我：好，那你快去煮面
阿泽：遵命。你也去喝口水，十分钟后互相汇报，谁赖皮谁请奶茶
我：成交
阿泽：说好了啊，我要少冰三分糖，你的还是老样子，我没忘`;
const state = {
  view: "home", step: 1, agents: [], active: null, turns: [], deleteIndex: null,
  draft: { log: "", name: "", relation: "", voice: false, mode: "fast", trainingStatus: "idle", trainingPhase: "" },
  settings: { key: "", computer: "https://arichm.dpdns.org" },
  busy: false, speaking: false, error: "", phase: "", voicePhase: "", fallbackNotice: "", generationId: 0,
  voiceGenerationId: 0, currentPlayer: null, muteOnce: false, connection: "checking", connectionCheckedAt: 0,
  callMuted: false, callSpeaker: true, callCaption: "", callReconnects: 0,
  groups: [], activeGroup: null, groupTurns: [], proactiveInbox: [], memoryTab: "pending",
  notificationsReady: false, groupAutoRunning: false, groupAutoToken: 0, groupAutoStatus: "",
  pendingImage: null, pendingGroupImage: null,
  dirty: false, callConfirmOpen: false, callSummary: null, pendingCallTurns: [], selectedVersionId: "",
  theme: localStorage.getItem("echo_theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
};
const playground = createPlayground({ agents: () => state.agents, request: requestArk, toast: showToast });
const root = document.querySelector("#app");
root.innerHTML = `<div id="view-root"><main class="app-skeleton" aria-label="正在打开回声"><div class="skeleton-head"><i></i><span></span><b></b><b></b></div><div class="skeleton-orb"></div><div class="skeleton-card"></div><div class="skeleton-action"></div></main></div><div id="dock-host"></div>`;
const viewRoot = root.querySelector("#view-root");
const dockHost = root.querySelector("#dock-host");
root.addEventListener("pointerdown", (event) => {
  const control = event.target.closest("button,[role='button']");
  if (!control || control.disabled) return;
  control.classList.add("is-pressed");
  const release = () => control.classList.remove("is-pressed");
  control.addEventListener("pointerup", release, { once: true });
  control.addEventListener("pointercancel", release, { once: true });
  window.setTimeout(release, 420);
});
let voiceAudioContext = null;
let voiceSampleTimer = null;
let generationPhaseTimer = 0;
const CHAT_WINDOW_SIZE = 80;
const CHAT_WINDOW_CHUNK = 40;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const agentHue = (a, i = 0) => 245 + ((Number(a?.id || i * 47) % 76) - 18);
const agentStyle = (a, i = 0) => `--agent-h:${agentHue(a, i)};--agent-h2:${(agentHue(a, i) + 38) % 360}`;
const avatarStyle = (a) => a?.avatar ? `background-image:url(${a.avatar});background-size:cover;background-position:center;color:transparent` : "";
const avatarText = (a) => a?.avatar ? "" : esc(a?.name?.[0] || "回");
const bridgeHeaders = () => ({ "Content-Type": "application/json", "X-Echo-Token": BUNDLED_ECHO_TOKEN });
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_MODEL = "doubao-seed-2-0-mini-260428";
const EchoSpeech = registerPlugin("EchoSpeech");
const IS_CHORD = import.meta.env.VITE_APP_VARIANT === "chord";
document.documentElement.classList.toggle("chord", IS_CHORD);
applyTheme(state.theme);
if (IS_CHORD) { state.view = "library"; document.title = "弦音"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#17212b"); }

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "light" ? "#f5f3f8" : (IS_CHORD ? "#17212b" : "#090812"));
}
let viewportFrame = 0;
let lastViewportHeight = 0;
function syncViewportHeight() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const height = Math.round(window.visualViewport?.height || window.innerHeight);
    if (Math.abs(height - lastViewportHeight) < 2) return;
    lastViewportHeight = height;
    document.documentElement.style.setProperty("--app-height", `${height}px`);
  });
}
syncViewportHeight();
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault(); event.returnValue = "";
});
function allowNavigation() {
  if (!state.dirty) return true;
  if (!window.confirm("当前修改还没有保存，确定离开吗？")) return false;
  state.dirty = false; return true;
}
function themeToggleMarkup(className = "") {
  const label = state.theme === "light" ? "切换深色模式" : "切换浅色模式";
  return `<button type="button" class="theme-toggle ${className}" data-theme-toggle aria-label="${label}" title="${label}"><i></i></button>`;
}
function showToast(message, tone = "info") {
  root.querySelector(".app-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `app-toast ${tone}`;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.textContent = message;
  root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  window.setTimeout(() => { toast.classList.remove("visible"); window.setTimeout(() => toast.remove(), 220); }, 3200);
}
function recordBackgroundIssue(context, error, notify = false) {
  const message = `${context}：${error?.message || error || "未知错误"}`;
  state.backgroundIssue = message;
  console.warn(message);
  if (notify) showToast(message, "error");
}
async function toggleTheme() {
  applyTheme(state.theme === "light" ? "dark" : "light");
  localStorage.setItem("echo_theme", state.theme);
  await Preferences.set({ key: "theme", value: state.theme });
}

function syncThemeControls() {
  const label = state.theme === "light" ? "切换深色模式" : "切换浅色模式";
  root.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  });
}

async function load() {
  try {
    const [agents, key, computer, theme, groups] = await Promise.all([
      Preferences.get({ key: "agents" }), Preferences.get({ key: "ark_api_key" }), Preferences.get({ key: "computer_url" }), Preferences.get({ key: "theme" }), Preferences.get({ key: "groups" })
    ]);
    state.agents = (agents.value ? JSON.parse(agents.value) : []).map(normalizeAgent);
    state.groups = (groups.value ? JSON.parse(groups.value) : []).map((group) => ({ turns: [], memberIds: [], ...group }));
    state.settings.key = key.value || BUNDLED_ARK_KEY;
    const savedComputer = computer.value || state.settings.computer;
    state.settings.computer = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(savedComputer) || /\.trycloudflare\.com/i.test(savedComputer)
      ? "https://arichm.dpdns.org"
      : savedComputer;
    if (theme.value) applyTheme(theme.value);
  } catch { state.settings.key = BUNDLED_ARK_KEY; }
  render();
  await runProactiveCheck();
  await initializeNotifications();
  const remindersChanged = await materializeDueReminders();
  await rescheduleSavedReminders();
  await scheduleRollingProactiveNotifications();
  // Legacy agents are normalized to the unified cloud response engine.
  if (remindersChanged) syncMaterializedMessages();
  checkComputerConnection();
  setInterval(() => checkComputerConnection(false), 30000);
}
let agentSaveQueue = Promise.resolve();
let groupSaveQueue = Promise.resolve();
function saveAgents() {
  const snapshot = JSON.stringify(state.agents);
  agentSaveQueue = agentSaveQueue.catch(() => {}).then(() => Preferences.set({ key: "agents", value: snapshot }));
  return agentSaveQueue;
}
function saveGroups() {
  const snapshot = JSON.stringify(state.groups);
  groupSaveQueue = groupSaveQueue.catch(() => {}).then(() => Preferences.set({ key: "groups", value: snapshot }));
  return groupSaveQueue;
}

async function postWithRetry(options, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await CapacitorHttp.post(options);
      if (response.status < 500 && ![408, 429].includes(response.status)) return response;
      lastError = new Error(`服务暂时不可用（${response.status}）`);
    } catch (error) { lastError = error; }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 350));
  }
  throw lastError || new Error("网络请求失败");
}
function arkOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output || []).filter((item) => item?.type === "message").flatMap((item) => item.content || []).filter((item) => item?.type === "output_text").map((item) => item.text || "").join("\n").trim();
}
async function requestArk({ instructions = "", messages = [], maxOutputTokens = 140 }) {
  if (!state.settings.key) throw new Error("请先在设置中填写火山方舟 API Key");
  const response = await postWithRetry({
    url: `${ARK_BASE_URL}/responses`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.settings.key}` },
    data: { model: ARK_MODEL, instructions, input: messages.map(({ role, content }) => ({ type: "message", role, content })), max_output_tokens: maxOutputTokens, thinking: { type: "disabled" }, store: false },
    connectTimeout: 8000, readTimeout: 60000
  }, 1);
  if (response.status !== 200) throw new Error(response.data?.error?.message || response.data?.message || `豆包返回 ${response.status}`);
  const text = arkOutputText(response.data);
  if (!text) throw new Error("豆包没有返回文字内容");
  return text;
}
function arkConversationMessages(turns) {
  const latestImageIndex = turns.findLastIndex((turn) => turn.role === "user" && turn.imageData);
  return turns.map((turn, index) => {
    if (index === latestImageIndex && turn.imageData) return { role: turn.role, content: [{ type: "input_text", text: turn.content || "请看看这张图片，并结合我们的对话自然回应。" }, { type: "input_image", image_url: turn.imageData }] };
    return { role: turn.role, content: `${turn.imageData ? "[用户发送了一张图片] " : ""}${turn.content || ""}`.trim() };
  });
}

function normalizeAgent(agent) {
  const legacy = Array.isArray(agent?.memories) ? agent.memories : [];
  return {
    memories: [], episodicMemories: [], pendingMemories: [], relationship: { score: 12, stage: "初识", messageCount: 0, lastContactAt: 0, activeDays: [], confirmedMemoryCount: 0 },
    proactive: { enabled: false, intervalHours: 24, quietStart: 23, quietEnd: 8, lastSentAt: 0 }, emotion: { warmth: 52, energy: 55, concern: 12, closeness: 24, updatedAt: Date.now(), reason: "刚刚认识" }, reminders: [], trainingVersions: [],
    ...agent,
    legacyMode: agent?.legacyMode || agent?.mode,
    mode: "fast", trainingStatus: "ready", trainingPhase: "",
    memories: legacy,
    episodicMemories: Array.isArray(agent?.episodicMemories) ? agent.episodicMemories : [],
    pendingMemories: Array.isArray(agent?.pendingMemories) ? agent.pendingMemories : [],
    relationship: { score: 12, stage: "初识", messageCount: 0, lastContactAt: 0, activeDays: [], confirmedMemoryCount: 0, ...(agent?.relationship || {}) },
    proactive: { enabled: false, intervalHours: 24, quietStart: 23, quietEnd: 8, lastSentAt: 0, ...(agent?.proactive || {}) },
    emotion: { warmth: 52, energy: 55, concern: 12, closeness: 24, updatedAt: Date.now(), reason: "自然平静", ...(agent?.emotion || {}) },
    reminders: Array.isArray(agent?.reminders) ? agent.reminders : [],
    trainingVersions: Array.isArray(agent?.trainingVersions) ? agent.trainingVersions : []
  };
}

function shell(content) {
  const header = ["home", "library", "chat", "groupChat", "playground"].includes(state.view) ? "" : `<header><button data-go="home" class="brand"><i></i><span>${IS_CHORD ? "弦音" : "回声"}<small>${IS_CHORD ? "CHORD" : "ECHO"}</small></span></button><div class="header-actions">${themeToggleMarkup()}<button data-go="settings" class="gear" aria-label="设置">⌁</button></div></header>`;
  const floatingTheme = state.view === "home" || state.view === "library" ? themeToggleMarkup("theme-toggle-floating") : "";
  return `<div class="ambient"><i></i><i></i><i></i></div>${header}${floatingTheme}${content}${deleteModal()}`;
}
function syncDock() {
  dockHost.innerHTML = "";
  dockHost.className = "dock-removed";
}
function deleteModal() {
  if (state.deleteIndex === null) return "";
  const a = state.agents[state.deleteIndex];
  if (!a) return "";
  return `<div class="modal-mask"><section class="delete-modal"><div class="danger-orb">×</div><h3>删除「${esc(a.name)}」？</h3><p>聊天记录和智能体设置将从这台手机移除，此操作无法撤销。</p><div><button data-cancel-delete>取消</button><button class="danger" data-confirm-delete>确认删除</button></div></section></div>`;
}
function home() {
  const connectionText = state.connection === "online" ? "服务器在线" : state.connection === "offline" ? "服务器离线" : "正在检测服务器";
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const latest = state.agents[0];
  return shell(`<main class="home calm-home"><section class="hero"><div class="home-intro"><small>${greeting}</small><h1>${latest ? `${esc(latest.name)} 在等你` : "让熟悉的声音留下来"}</h1></div><div class="echo"><i></i><i></i><i></i><b></b><span>在吗</span><span>晚安</span><span>到家叫我</span></div><button class="home-library" data-go="library"><span><i style="${avatarStyle(latest)}">${avatarText(latest)}</i><b>${latest ? `继续与 ${esc(latest.name)} 对话` : "我的回声"}</b><small>${latest ? `${esc(latest.relation || "重要的人")} · ${state.agents.length} 个回声` : "还没有创建智能体"}</small></span><em>›</em></button><button class="primary home-create" data-create><span>创建新的回声</span><b>＋</b></button><button class="connection-badge ${state.connection}" data-check-connection><i></i>${connectionText}</button></section></main>`);
}
function library() {
  const proactiveCount = state.agents.reduce((sum, agent) => sum + Number(agent.proactiveUnread || 0), 0);
  return shell(`<main class="library"><section class="library-head"><button data-go="home">‹</button><div><small>YOUR ECHOES</small><h1>我的回声</h1><p>${state.agents.length ? `${state.agents.length} 个正在等待你的声音${proactiveCount ? ` · ${proactiveCount} 条新消息` : ""}` : "从一次创建，开始新的陪伴"}</p></div><button data-create aria-label="新建回声">＋</button></section><section class="library-tools"><button data-new-group><i>◎</i><span><b>多人聊天</b><small>让多个回声自然地聊在一起</small></span><em>＋</em></button></section><section class="library-list"><div class="cards">${state.groups.map((g, i) => `<article class="agent group-card"><button class="agent-open" data-group="${i}"><i>群</i><span><b>${esc(g.name)}</b><small>${g.memberIds.length} 位成员 · ${(g.turns || []).length} 条消息</small></span><em>›</em></button></article>`).join("")}${state.agents.map((a, i) => `<article class="agent" style="--delay:${i * 65}ms;${agentStyle(a, i)}"><button class="agent-open" data-agent="${i}"><i style="${avatarStyle(a)}">${avatarText(a)}</i><span><b>${esc(a.name)}${a.proactiveUnread ? `<sup>${a.proactiveUnread}</sup>` : ""}</b><small>${esc(a.relation || "重要的人")} · ${relationshipStage(a)}${a.voiceReady ? " · 有声" : ""}</small></span><em>›</em></button><button class="agent-delete" data-detail="${i}" aria-label="查看 ${esc(a.name)} 的详情">···</button></article>`).join("") || `<section class="library-empty"><div class="mini-orb"></div><h2>这里还很安静</h2><p>粘贴一段聊天记录，让第一个回声在这里醒来。</p><button class="primary" data-create>创建第一个回声</button></section>`}</div></section></main>`);
}
function profile() {
  const a = state.active;
  const i = Math.max(0, state.agents.indexOf(a));
  const status = "素材即时生效";
  const photoCount = (a.turns || []).filter((turn) => turn.imageData).length;
  return shell(`<main class="profile compact-profile" style="${agentStyle(a, i)}"><section class="profile-hero"><button data-go="library" class="profile-back">‹</button><div class="profile-orb"><i></i><b>${esc(a.name?.[0] || "回")}</b><i></i></div><small>DIGITAL ECHO</small><h1>${esc(a.name)}</h1><p>${esc(a.relation || "重要的人")}</p><button class="primary profile-chat" data-open-chat>开始对话 <span>→</span></button></section><section class="profile-sheet"><div class="profile-stats"><span>关系阶段<b>${relationshipStage(a)}</b></span><span>当前状态<b>${emotionLabel(a)}</b></span><span>已确认记忆<b>${(a.memories || []).length + (a.episodicMemories || []).length} 条</b></span></div><div class="relationship-card"><div><small>EMOTIONAL CONTINUITY</small><b>${emotionLabel(a)}</b></div><i><b style="width:${currentEmotion(a).warmth}%"></b></i><p>${esc(currentEmotion(a).reason)}。状态会随交流轻微变化，并在 72 小时内逐渐回归平静。</p></div><div class="profile-menu"><button data-go="album"><i>▧</i><span><b>共同相册</b><small>${photoCount ? `${photoCount} 张一起看过的照片` : "把生活里的画面分享给TA"}</small></span><em>›</em></button><button data-go="memory"><i>◇</i><span><b>记忆与生活事件</b><small>${(a.pendingMemories || []).length ? `${a.pendingMemories.length} 条等待确认` : nextLifeThread(a)}</small></span><em>›</em></button><button data-go="proactive"><i>✦</i><span><b>主动联系</b><small>${a.proactive?.enabled ? `已开启 · ${proactiveFrequencyText(a)}` : "关闭"}</small></span><em>›</em></button><button data-invite-agent><i>◎</i><span><b>邀请另一个回声</b><small>从这里开始多人聊天</small></span><em>›</em></button><button data-go="versions"><i>↺</i><span><b>素材版本</b><small>${status}</small></span><em>›</em></button><button data-incremental><i>＋</i><span><b>补充了解</b><small>添加新的聊天记录并预览变化</small></span><em>›</em></button></div><div class="profile-actions"><button class="profile-delete" data-delete-active>更多设置与删除</button></div></section></main>`);
}

function lifeAlbum() {
  const photos = (state.active?.turns || []).filter((turn) => turn.imageData).reverse();
  return shell(`<main class="subpage life-album"><section class="subhead"><button data-go="profile">‹</button><span><small>SHARED LIFE</small><h1>共同相册</h1></span></section><p class="album-lead">你分享过的生活画面，会连同当时说的话一起留下。</p><section class="album-grid">${photos.map((photo) => `<article><img src="${photo.imageData}" alt="共同相册照片" loading="lazy"><span><b>${esc(photo.content || "一张生活照片")}</b><small>${formatChatDate(normalizeTimestamp(photo.createdAt))}</small></span></article>`).join("") || `<div class="album-empty"><b>还没有共同照片</b><p>在聊天中点图片按钮，把今天看到的东西分享给TA。</p></div>`}</section></main>`);
}

function memoryRow(item, layer) {
  const source = item.source === "manual" || !item.automatic ? "用户添加" : item.source === "call" ? "通话摘要" : item.source === "photo" ? "共同相册" : "对话中识别";
  const eventState = layer === "episode" ? `<select data-event-status="${esc(item.id)}"><option value="planned" ${item.status === "planned" ? "selected" : ""}>计划中</option><option value="waiting" ${item.status === "waiting" ? "selected" : ""}>等待结果</option><option value="completed" ${item.status === "completed" ? "selected" : ""}>已完成</option><option value="cancelled" ${item.status === "cancelled" ? "selected" : ""}>已取消</option><option value="expired" ${item.status === "expired" ? "selected" : ""}>已过期</option></select>` : "";
  return `<li><span>${esc(item.text)}<small>${source} · ${new Date(item.createdAt || Date.now()).toLocaleDateString("zh-CN")}</small>${eventState}</span><button data-delete-memory="${esc(item.id)}" data-layer="${layer}" aria-label="删除记忆">×</button></li>`;
}

function memoryCenter() {
  const a = state.active; const tab = state.memoryTab || "pending";
  const lists = { pending: a.pendingMemories || [], recent: (a.turns || []).slice(-12).reverse(), episode: a.episodicMemories || [], long: a.memories || [] };
  const labels = { pending: "待确认", recent: "最近", episode: "经历", long: "长期" };
  const rows = lists[tab].map((item) => tab === "pending" ? `<li class="pending-memory"><span>${esc(item.text)}<small>建议放入${item.suggestedLayer === "episode" ? "经历" : "长期"}记忆</small></span><div><button data-memory-accept="${esc(item.id)}">保留</button><button data-memory-edit="${esc(item.id)}">修改</button><button data-delete-memory="${esc(item.id)}" data-layer="pending">忘记</button></div></li>` : tab === "recent" ? `<li><span>${esc(item.content)}<small>${item.role === "user" ? "你" : a.name} · 仅作近期上下文</small></span></li>` : memoryRow(item, tab)).join("");
  return shell(`<main class="subpage memory-page"><section class="subhead"><button data-go="profile">‹</button><span><small>MEMORY</small><h1>记忆</h1></span></section><nav class="memory-tabs">${Object.entries(labels).map(([key, label]) => `<button data-memory-tab="${key}" class="${tab === key ? "active" : ""}">${label}${key === "pending" && lists.pending.length ? `<b>${lists.pending.length}</b>` : ""}</button>`).join("")}</nav><section class="memory-content"><div class="memory-guide">${tab === "pending" ? "自动识别的内容不会直接成为永久事实，需要你确认。" : tab === "episode" ? "生活事件拥有状态，完成后不会反复追问。" : tab === "long" ? "身份、偏好和重要约定会长期影响回答。" : "最近的上下文会自动滚动，不等同于长期记忆。"}</div><ul>${rows || `<li class="empty">这里暂时没有内容</li>`}</ul>${tab === "long" ? `<form id="memory-form"><input id="memory-input" maxlength="100" placeholder="手动添加并锁定长期记忆"><button>＋</button></form>` : ""}</section></main>`);
}

function proactiveSettings() {
  const p = state.active.proactive || {};
  const plan = proactivePlan(state.active);
  return shell(`<main class="subpage"><section class="subhead"><button data-go="profile">‹</button><span><small>PROACTIVE</small><h1>主动联系</h1></span></section><section class="setting-sheet">${state.backgroundIssue ? `<p class="system-warning">${esc(state.backgroundIssue)}</p>` : ""}<label class="switch-row"><span><b>允许主动联系</b><small>结合情绪、关系、生活事件和安静时段决定</small></span><input type="checkbox" data-proactive-toggle ${p.enabled ? "checked" : ""}></label><label>大致频率<select id="proactive-frequency"><option value="12" ${p.intervalHours === 12 ? "selected" : ""}>偶尔</option><option value="24" ${p.intervalHours === 24 ? "selected" : ""}>每天</option><option value="168" ${p.intervalHours === 168 ? "selected" : ""}>每周</option></select></label><div class="quiet-grid"><label>免打扰开始<input id="quiet-start" type="number" min="0" max="23" value="${p.quietStart ?? 23}"></label><label>免打扰结束<input id="quiet-end" type="number" min="0" max="23" value="${p.quietEnd ?? 8}"></label></div><label>消息倾向<select id="proactive-style"><option value="continue" ${p.style === "continue" ? "selected" : ""}>延续上次话题</option><option value="greeting" ${p.style === "greeting" ? "selected" : ""}>轻问候</option><option value="care" ${p.style === "care" ? "selected" : ""}>生活关心</option></select></label><div class="proactive-preview"><small>NEXT MESSAGE PREVIEW</small><p>${esc(plan.body)}</p><em>联系原因：${esc(plan.reason)}</em></div><button class="primary full" data-save-proactive>保存设置</button></section></main>`);
}
function decorateReminderSettings() {
  const sheet = root.querySelector(".setting-sheet"); const save = sheet?.querySelector("[data-save-proactive]");
  if (!sheet || !save || !state.active) return;
  const reminders = (state.active.reminders || []).filter((item) => Number(item.at) > Date.now()).sort((a, b) => a.at - b.at);
  const markup = `<section class="reminder-settings"><small>UPCOMING REMINDERS</small><h3>即将提醒</h3>${reminders.length ? reminders.map((item) => `<div><span><b>${esc(item.task)}</b><small>${esc(formatReminderTime(item.at))}</small></span><button data-cancel-reminder="${item.id}">取消</button></div>`).join("") : `<p>在聊天里说“明天九点叫我”，提醒会出现在这里。</p>`}</section>`;
  save.insertAdjacentHTML("beforebegin", markup);
}
async function cancelReminder(id) {
  if (!state.active) return;
  state.active.reminders = (state.active.reminders || []).filter((item) => Number(item.id) !== Number(id));
  try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (error) { recordBackgroundIssue("取消系统提醒失败", error, true); }
  await saveAgents(); render();
}

function versionCenter() {
  const a = state.active; const versions = [{ id: "current", createdAt: a.lastIncrementalAt || Number(a.id) || Date.now(), chars: String(a.log || "").length, current: true }, ...(a.trainingVersions || [])];
  return shell(`<main class="subpage"><section class="subhead"><button data-go="profile">‹</button><span><small>VERSIONS</small><h1>素材版本</h1></span></section><section class="version-list">${versions.map((v, index) => `<article class="${v.current ? "current" : ""}"><i>${v.current ? "✓" : index}</i><span><b>${v.current ? "当前使用版本" : `${new Date(v.createdAt).toLocaleString("zh-CN")} 的版本`}</b><small>${v.chars || String(v.log || "").length} 字 · ${v.current ? (a.trainingPhase || "正在使用") : "可预览和恢复"}</small></span>${!v.current ? `<button data-rollback-version="${esc(v.id)}">恢复</button>` : ""}</article>`).join("")}<button class="primary full" data-incremental>补充新的聊天素材</button></section></main>`);
}

function groupSetup() {
  const editing = state.groupEditing ? state.activeGroup : null;
  const selected = new Set(editing?.memberIds || (state.groupSeedId ? [String(state.groupSeedId)] : []));
  return shell(`<main class="wizard group-setup"><button data-go="${editing ? "groupChat" : "library"}" class="back">← 返回</button><section class="panel"><div class="step-icon">◎</div><h2>${editing ? "管理多人聊天" : "创建多人聊天"}</h2><p>默认只由最相关的一位回声回答；提到“大家”时才会自然接力。</p><label>群聊名称<input id="group-name" maxlength="24" value="${esc(editing?.name || "")}" placeholder="例如：周末闲聊"></label><div class="group-members">${state.agents.map((a) => `<label><input type="checkbox" value="${esc(a.id)}" ${selected.has(String(a.id)) ? "checked" : ""}><i style="${avatarStyle(a)}">${avatarText(a)}</i><span><b>${esc(a.name)}</b><small>${esc(a.relation || "重要的人")}</small></span></label>`).join("") || "<p>请先创建至少两个智能体</p>"}</div><button class="primary full" data-create-group ${state.agents.length < 2 ? "disabled" : ""}>${editing ? "保存群聊" : "创建群聊"} <span>→</span></button>${editing ? `<button class="danger-text" data-delete-group>删除这个群聊</button>` : ""}</section></main>`);
}

function groupChat() {
  const group = state.activeGroup;
  const members = groupMembers(group);
  const start = Math.max(0, Math.min(Number(state.groupWindowStart ?? Math.max(0, state.groupTurns.length - CHAT_WINDOW_SIZE)), state.groupTurns.length));
  state.groupWindowStart = start;
  const messages = `${start ? `<div class="chat-window-spacer" data-group-spacer style="height:${start * 76}px"><button type="button" data-load-older-group>查看更早的 ${start} 条消息</button></div>` : ""}${state.groupTurns.slice(start).map((turn, offset) => groupMessageMarkup(turn, start + offset)).join("")}`;
  const preview = state.pendingGroupImage ? `<div class="group-image-preview"><img src="${state.pendingGroupImage.data}" alt="待发送图片"><button type="button" data-remove-group-image>×</button></div>` : "";
  return shell(`<main class="group-chat"><div class="chathead"><button data-go="library">‹</button><div class="group-stack">${members.slice(0, 3).map((a) => `<i style="${avatarStyle(a)}">${avatarText(a)}</i>`).join("")}</div><span><b>${esc(group?.name || "多人聊天")}</b><small>${members.map((a) => esc(a.name)).join("、")}</small></span><button class="group-manage" data-manage-group>•••</button>${themeToggleMarkup("chat-theme-toggle")}</div><div class="group-msgs">${messages || `<div class="group-welcome"><b>群聊已创建</b><p>可以 @某个名字；不点名时只会由最相关的一位回应。</p></div>`}${state.busy ? `<div class="generation-status thinking-state"><i class="thinking-core">群</i><span>正在判断由谁回应</span></div>` : ""}${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}</div>${preview}<form id="group-send"><label class="group-image-attach" aria-label="分享图片">＋<input id="groupImageFile" type="file" accept="image/jpeg,image/png,image/webp"></label><textarea id="group-message" rows="1" placeholder="和大家说点什么…" ${state.busy ? "disabled" : ""}></textarea><button ${state.busy ? "disabled" : ""}>↑</button></form></main>`);
}

function groupMessageMarkup(turn, index, entering = false) {
  const agent = turn.agent || state.agents.find((item) => String(item.id) === String(turn.agentId));
  const label = agent ? `<small>${esc(agent.name)}${turn.routingReason ? ` · ${esc(turn.routingReason)}` : ""}</small>` : "";
  const image = turn.imageData ? `<img class="group-message-image" src="${turn.imageData}" alt="群聊图片" loading="lazy">` : "";
  const replyTo = turn.replyTo ? `<em class="group-reply-to">回复 ${esc(turn.replyTo)}</em>` : "";
  return `<div class="group-message ${turn.role}${entering ? " is-entering" : ""}" data-group-turn="${index}">${turn.role === "assistant" && agent ? `<i style="${avatarStyle(agent)}">${avatarText(agent)}</i>` : ""}<span>${label}${replyTo}${image}${turn.content ? esc(turn.content) : ""}</span></div>`;
}

function appendGroupMessageNode(turn) {
  const messages = root.querySelector(".group-msgs");
  if (!messages) return;
  messages.querySelector(".group-welcome")?.remove();
  messages.querySelector(".group-typing")?.remove();
  messages.insertAdjacentHTML("beforeend", groupMessageMarkup(turn, state.groupTurns.length - 1, true));
  keepChatAtBottom(messages, true);
}

function setGroupBusyUI(busy, label = "正在判断由谁回应") {
  const form = root.querySelector("#group-send");
  form?.querySelectorAll("textarea, button").forEach((element) => { element.disabled = busy; });
  const messages = root.querySelector(".group-msgs");
  messages?.querySelector(".group-typing")?.remove();
  if (busy && messages) {
    messages.insertAdjacentHTML("beforeend", `<div class="group-typing is-entering"><i></i><i></i><i></i><span>${esc(label)}</span></div>`);
    keepChatAtBottom(messages, true);
  }
}

function incrementalLearning() {
  const a = state.active;
  return shell(`<main class="wizard incremental"><button data-go="profile" class="back">← 返回</button><section class="panel"><div class="step-icon">＋</div><h2>补充聊天素材</h2><p>先预览变化，再决定是否更新。旧版本会保留，可随时恢复。</p><div class="version-summary"><span>当前素材<b>${String(a.log || "").length} 字</b></span><span>历史版本<b>${(a.trainingVersions || []).length}</b></span></div><textarea id="incremental-log" placeholder="粘贴新增的聊天记录…"></textarea><div class="material-preview"><span><small>新增</small><b data-new-count>0 条</b></span><span><small>重复</small><b data-duplicate-count>0 条</b></span><span><small>说话人</small><b data-speaker-count>0 人</b></span><span><small>可用样本</small><b data-sample-count>0 条</b></span></div><div class="under"><small>素材保存后立即更新表达参考</small></div><button class="primary full" data-apply-incremental disabled>确认更新 <span>→</span></button>${(a.trainingVersions || []).length ? `<button class="version-rollback" data-rollback-training>回退到上一个素材版本</button>` : ""}</section></main>`);
}
function wizard() {
  const d = state.draft; let body = "";
  if (state.step === 1) body = `<div class="step-icon">01</div><h2>粘贴聊天记录</h2><p>无需整理格式，原样粘贴即可。内容越丰富，语气模仿越准确。</p><textarea id="log" placeholder="粘贴微信、短信或其他聊天记录…">${esc(d.log)}</textarea><div class="under"><button data-sample>使用示例</button><span>${d.log.length} 字</span></div><button class="primary full" data-next ${d.log.length < 20 ? "disabled" : ""}>下一步 <span>→</span></button>`;
  if (state.step === 2) body = `<div class="step-icon">02</div><h2>确认 TA 的信息</h2><p>${d.detected ? `已从聊天记录识别出 ${esc(d.detected)}，你只需确认或修改。` : "没有识别到明确称呼，请手动填写。"}</p><label class="avatar-picker"><i style="${avatarStyle(d)}">${avatarText(d)}</i><span><b>${d.avatar ? "更换头像" : "添加头像"}</b><small>支持 JPG、PNG，自动压缩</small></span><input id="agentAvatarFile" type="file" accept="image/*"></label><label>称呼<input id="name" value="${esc(d.name)}" placeholder="例如：阿泽、妈妈、小雨"></label><label>你们的关系<input id="relation" value="${esc(d.relation)}" placeholder="朋友、家人、同事"></label><button class="primary full" data-next ${!d.name ? "disabled" : ""}>下一步 <span>→</span></button>`;
  if (state.step === 3) body = `<div class="step-icon">03</div><h2>添加声音吗？</h2><p>录制或上传 10–30 秒清晰人声。仅可使用已获得本人明确授权的声音。</p><div class="choices"><button data-voice="false" class="${!d.voice ? "selected" : ""}"><b>⌨</b>暂时跳过<small>仅文字对话</small></button><button data-voice="true" class="${d.voice ? "selected" : ""}"><b>◉</b>克隆音色<small>直接录音或选择文件</small></button></div>${d.voice ? voiceCaptureMarkup(d) : ""}<button class="primary full" data-next ${d.voice && !d.voiceReady ? "disabled" : ""}>下一步 <span>→</span></button>`;
  if (state.step === 4) body = `<div class="ready"><span>${esc(d.name?.[0] || "回")}</span><i></i><i></i></div><h2 class="center">${esc(d.name)} 的回声已准备好</h2><div class="summary"><span>样本<b>${d.log.length} 字</b></span><span>回应<b>豆包 · 支持图片</b></span><span>声音<b>${d.voiceReady ? "已克隆" : "未添加"}</b></span></div><button class="primary full" data-finish>完成并开始对话 →</button>`;
  return shell(`<main class="wizard"><button data-back class="back">← 返回</button><div class="progress"><i style="width:${state.step / 4 * 100}%"></i></div><small>STEP ${String(state.step).padStart(2, "0")} / 04</small><section class="panel">${body}</section></main>`);
}
function voiceCaptureMarkup(d) {
  if (d.recordedAudio) return `<section class="voice-review"><div class="voice-review-head"><i>✓</i><span><b>录音已完成</b><small>${Math.round((d.recordedDuration || 0) / 1000)} 秒 · 请先试听</small></span></div><audio controls preload="metadata" src="data:${esc(d.recordedMime || "audio/mp4")};base64,${d.recordedAudio}"></audio><div><button type="button" data-rerecord-voice>重新录制</button><button type="button" data-confirm-recording>使用这段录音</button></div></section><small class="voice-status">${esc(d.voiceStatus || "试听满意后确认上传")}</small>`;
  return `<section class="voice-capture"><button type="button" class="voice-record-button" data-record-voice><i class="record-dot"></i><span><b>${d.voiceReady ? "重新录制" : "开始录音"}</b><small>建议安静环境，保持自然语气</small></span><time>00:00</time></button><div class="record-wave" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div><label class="audio-upload compact">从手机选择音频<input id="voiceFile" type="file" accept="audio/*"></label></section><small class="voice-status">${esc(d.voiceStatus || (d.voiceReady ? "音色样本已就绪，可直接下一步" : "录音时长需要 10–30 秒"))}</small>`;
}
function chat() {
  const a = state.active;
  const start = Math.max(0, Math.min(Number(state.chatWindowStart ?? Math.max(0, state.turns.length - CHAT_WINDOW_SIZE)), state.turns.length));
  state.chatWindowStart = start;
  const messages = `${start ? `<div class="chat-window-spacer" data-chat-spacer style="height:${start * 82}px"><button type="button" data-load-older>查看更早的 ${start} 条消息</button></div>` : ""}${state.turns.slice(start).map((t, offset) => messageMarkup(t, start + offset)).join("")}`;
  const status = state.busy ? thinkingMarkup() : state.fallbackNotice ? `<div class="fallback-notice">${esc(state.fallbackNotice)}</div>` : "";
  const call = state.callActive && !state.callMinimized ? callMarkup() : "";
  const imagePreview = state.pendingImage ? `<div class="pending-image"><img src="${state.pendingImage.data}" alt="待发送图片"><span>${esc(state.pendingImage.name || "图片")}</span><button type="button" data-remove-image aria-label="移除图片">×</button></div>` : "";
  return shell(`<main class="chat wechat-chat" style="${agentStyle(a)}"><div class="chathead"><button data-go="home">‹</button><div class="chat-avatar"><i style="${avatarStyle(a)}">${avatarText(a)}<b></b></i></div><span><b>${esc(a.name)}</b><small>${state.busy ? "正在回应" : "在线"}</small></span><button class="call-button" data-start-call aria-label="语音通话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.96.72 2.88a2 2 0 0 1-.45 2.11L8.1 10a16 16 0 0 0 6 6l1.29-1.29a2 2 0 0 1 2.11-.45c.92.35 1.88.59 2.88.72A2 2 0 0 1 22 16.92z"/></svg><span>通话</span></button>${themeToggleMarkup("chat-theme-toggle")}</div><div class="msgs">${messages}${status}${voiceStatusMarkup()}${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}</div>${imagePreview}<form id="send" class="${state.pendingImage ? "has-text" : ""}"><label class="image-attach" aria-label="选择图片"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15.5 8.5h.01"/></svg><input id="chatImageFile" type="file" accept="image/jpeg,image/png,image/webp"></label><button type="button" class="voice-mode-button" data-voice-mode aria-label="切换语音输入"><i></i></button><div class="composer"><textarea id="message" rows="1" placeholder="${state.busy ? "正在回应…" : state.pendingImage ? "说说这张图片…" : "说点什么…"}" ${state.busy ? "disabled" : ""}></textarea><button type="button" class="hold-to-talk" data-hold-talk hidden>按住 说话</button><span class="composer-glow"></span></div><button type="submit" class="send-morph composer-action" data-composer-action aria-label="发送" ${state.busy ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg><span>发送</span></button></form><div class="recording-sheet" hidden><i></i><b>正在聆听</b><output aria-live="polite">等待你开口…</output><span>说完后稍等片刻</span><button type="button" data-cancel-recording>取消</button></div>${call}</main>`);
}
function thinkingMarkup() {
  return `<div class="generation-status thinking-state"><i class="thinking-core">${esc(state.active?.name?.[0] || "回")}</i><span>${esc(state.phase || "正在回应")}</span><button data-stop-generation>停止</button></div>`;
}
function callMarkup() {
  const a = state.active;
  return `<section class="call-screen wechat-call"><div class="call-backdrop"><i></i></div><button class="call-minimize" data-end-call aria-label="返回">‹</button><div class="call-person"><div class="call-avatar" style="${avatarStyle(a)}">${avatarText(a)}</div><h2>${esc(a?.name || "回声")}</h2><p data-call-phase>${esc(state.callPhase || "正在连接…")}</p><time data-call-duration>00:00</time><output class="call-caption" data-call-caption>${esc(state.callCaption || "实时字幕会显示在这里")}</output><div class="call-wave">${Array.from({length:12},(_,i)=>`<i style="--i:${i}"></i>`).join("")}</div></div><button class="call-interrupt" data-call-interrupt>打断并说话</button><div class="call-actions"><button class="call-tool ${state.callMuted ? "active" : ""}" data-call-mute><i class="mute-icon"></i><span>${state.callMuted ? "取消静音" : "静音"}</span></button><button class="hangup" data-end-call><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.96.72 2.88a2 2 0 0 1-.45 2.11L8.1 10a16 16 0 0 0 6 6l1.29-1.29a2 2 0 0 1 2.11-.45c.92.35 1.88.59 2.88.72A2 2 0 0 1 22 16.92z"/></svg></i><span>挂断</span></button><button class="call-tool ${state.callSpeaker ? "active" : ""}" data-call-speaker><i class="speaker-icon"></i><span>${state.callSpeaker ? "扬声器" : "听筒"}</span></button></div></section>`;
}
function bindCallControls() {
  root.querySelectorAll(".hangup[data-end-call]").forEach((button) => button.addEventListener("click", endCall));
  root.querySelector(".call-minimize")?.addEventListener("click", minimizeCall);
  root.querySelector("[data-call-mute]")?.addEventListener("click", toggleCallMute);
  root.querySelector("[data-call-speaker]")?.addEventListener("click", toggleCallSpeaker);
  root.querySelector("[data-call-interrupt]")?.addEventListener("click", interruptCall);
}
function minimizeCall() {
  if (!state.callActive) return;
  state.callMinimized = true; root.querySelector(".wechat-call")?.remove();
  const chat = root.querySelector(".wechat-chat");
  if (chat && !chat.querySelector(".call-mini")) chat.insertAdjacentHTML("afterbegin", `<button class="call-mini" data-restore-call><i></i><span>${esc(state.active?.name)} · 通话中</span><b>返回</b></button>`);
  root.querySelector("[data-restore-call]")?.addEventListener("click", restoreCall);
}
function restoreCall() {
  if (!state.callActive) return;
  state.callMinimized = false; root.querySelector(".call-mini")?.remove();
  root.querySelector(".wechat-chat")?.insertAdjacentHTML("beforeend", callMarkup()); bindCallControls(); syncCallUI();
}
function syncCallUI() {
  const screen = root.querySelector(".wechat-call");
  if (!screen) return;
  const phase = screen.querySelector("[data-call-phase]");
  if (phase) phase.textContent = state.callPhase || "正在连接…";
  const duration = screen.querySelector("[data-call-duration]");
  if (duration && state.callStartedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - state.callStartedAt) / 1000));
    duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  screen.classList.toggle("is-speaking", state.callPhase === "对方正在说话");
  screen.classList.toggle("is-listening", /聆听|请说话/.test(state.callPhase || ""));
  screen.classList.toggle("is-thinking", /理解|生成|连接|呼叫/.test(state.callPhase || ""));
  const caption = screen.querySelector("[data-call-caption]"); if (caption) caption.textContent = state.callCaption || "实时字幕会显示在这里";
  const mute = screen.querySelector("[data-call-mute]");
  if (mute) { mute.classList.toggle("active", state.callMuted); mute.querySelector("span").textContent = state.callMuted ? "取消静音" : "静音"; }
  screen.querySelector("[data-call-speaker]")?.classList.toggle("active", state.callSpeaker);
}
async function toggleCallMute() {
  state.callMuted = !state.callMuted;
  if (state.callMuted) {
    state.callPhase = "麦克风已关闭";
    try { await EchoSpeech.stop(); } catch {}
  } else state.callPhase = "正在聆听…";
  syncCallUI();
  if (!state.callMuted && state.callActive) setTimeout(callListen, 180);
}
async function toggleCallSpeaker() {
  const previous = state.callSpeaker;
  state.callSpeaker = !previous;
  try { await EchoSpeech.setAudioRoute({ speaker: state.callSpeaker }); }
  catch (error) {
    state.callSpeaker = previous;
    recordBackgroundIssue("切换音频输出失败", error, true);
  }
  const label = root.querySelector("[data-call-speaker] span");
  if (label) label.textContent = state.callSpeaker ? "扬声器" : "听筒";
  syncCallUI();
}
async function interruptCall() {
  if (!state.callActive) return;
  state.generationId++; stopVoice();
  try { await EchoSpeech.stopSpeaking(); } catch {}
  state.busy = false; state.callPhase = "已打断，请说话"; state.callCaption = ""; syncCallUI();
  setTimeout(callListen, 120);
}
function voiceStatusMarkup() {
  if (!state.speaking) return "";
  return `<div class="voice-pill"><span class="voice-wave">${Array.from({length: 9}, (_, i) => `<i style="--bar:${i}"></i>`).join("")}</span><b>${esc(state.voicePhase || "正在生成声音")}</b><button data-stop-voice>停止语音</button></div>`;
}

function normalizeTimestamp(value, fallback = Date.now()) {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 100000000000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localDayNumber(value) {
  const date = new Date(normalizeTimestamp(value));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatChatDate(value, includeTime = true) {
  const stamp = normalizeTimestamp(value);
  const date = new Date(stamp);
  const dayDifference = Math.round((localDayNumber(Date.now()) - localDayNumber(stamp)) / 86400000);
  const prefix = dayDifference === 0 ? "今天" : dayDifference === 1 ? "昨天" : dayDifference === 2 ? "前天" : date.getFullYear() === new Date().getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (!includeTime) return prefix;
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${prefix} ${time}`;
}

function messageMarkup(turn, index, includeTime = true) {
  const previous = state.turns[index - 1];
  const next = state.turns[index + 1];
  const stamp = normalizeTimestamp(turn.createdAt);
  const previousStamp = previous ? normalizeTimestamp(previous.createdAt, stamp) : 0;
  const nextStamp = next ? normalizeTimestamp(next.createdAt, stamp) : stamp;
  const groupedWithPrevious = previous?.role === turn.role && localDayNumber(previousStamp) === localDayNumber(stamp) && stamp - previousStamp < 120000;
  const groupedWithNext = next?.role === turn.role && localDayNumber(nextStamp) === localDayNumber(stamp) && nextStamp - stamp < 120000;
  const groupClass = `${groupedWithPrevious ? " group-middle" : " group-start"}${groupedWithNext ? "" : " group-end"}`;
  const avatar = turn.role === "assistant" ? (!groupedWithNext ? `<i class="message-avatar" style="${avatarStyle(state.active)}">${avatarText(state.active)}</i>` : `<i class="message-avatar placeholder"></i>`) : "";
  const showTime = index === 0 || turn.timestampEstimated || previous?.timestampEstimated || localDayNumber(previousStamp) !== localDayNumber(stamp) || (stamp - previousStamp) > 300000;
  const displayTime = turn.timestampEstimated ? "历史记录 · 时间未知" : formatChatDate(stamp);
  const voiceMark = turn.inputType === "voice" ? `<span class="voice-message-mark"><i></i><i></i><i></i><i></i><i></i><b>语音转文字</b></span>` : "";
  const imageMark = turn.imageData ? `<img class="message-image" src="${turn.imageData}" alt="聊天图片" loading="lazy">` : "";
  const proactiveMark = turn.proactive ? `<span class="proactive-mark"${turn.proactiveReason ? ` title="${esc(turn.proactiveReason)}"` : ""}>AI 主动联系${turn.proactiveReason ? ` · ${esc(turn.proactiveReason)}` : ""}</span>` : "";
  const reminderMark = turn.reminderAt ? `<span class="reminder-mark ${turn.reminderStatus === "failed" ? "warning" : ""}">${turn.reminderStatus === "failed" ? "! 未获得系统通知权限 · " : "◷ "}${esc(formatReminderTime(turn.reminderAt))}</span>` : "";
  return `${includeTime && showTime ? `<time class="chat-time">${displayTime}</time>` : ""}<div class="message-wrap ${turn.role}${groupClass}">${avatar}<div class="msg ${turn.role}${turn.streaming ? " streaming" : ""}" data-message-index="${index}" style="--delay:${Math.min(index, 8) * 35}ms">${proactiveMark}${voiceMark}${imageMark}${turn.content ? `<span class="message-text">${esc(turn.content)}</span>` : ""}${reminderMark}${turn.streaming ? `<i class="stream-caret"></i>` : ""}<small class="message-time">${displayTime}</small></div></div>`;
}
function bindMessageInteractions(scope = root) {
  scope.querySelectorAll?.(".msg").forEach((message) => {
    if (message.dataset.metaBound) return;
    message.dataset.metaBound = "1";
    message.addEventListener("click", () => {
      if (Date.now() - Number(message.dataset.swipedAt || 0) < 320) return;
      message.classList.toggle("show-meta");
    });
  });
}

function gestureBackTarget() {
  if (["chat", "groupChat", "profile"].includes(state.view)) return "library";
  if (["memory", "proactive", "versions", "incremental"].includes(state.view)) return "profile";
  if (["library", "settings", "groupSetup"].includes(state.view)) return "home";
  return "";
}

function bindChatGestures() {
  const page = root.querySelector(".wechat-chat,.group-chat");
  if (!page) return;
  page.querySelectorAll(".msg").forEach((message) => {
    if (message.dataset.gestureBound) return;
    message.dataset.gestureBound = "1";
    let pointerId = null; let startX = 0; let startY = 0; let horizontal = false;
    message.addEventListener("pointerdown", (event) => { pointerId = event.pointerId; startX = event.clientX; startY = event.clientY; horizontal = false; });
    message.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX; const dy = event.clientY - startY;
      if (!horizontal && Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.3) horizontal = true;
      if (!horizontal || dx > 0) return;
      message.style.transform = `translate3d(${Math.max(-26, dx * .32)}px,0,0)`;
    });
    const finish = (event) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      if (horizontal && dx < -34) { message.classList.add("show-meta"); message.dataset.swipedAt = Date.now(); }
      message.style.transform = ""; pointerId = null;
    };
    message.addEventListener("pointerup", finish);
    message.addEventListener("pointercancel", () => { message.style.transform = ""; pointerId = null; });
  });
  if (page.dataset.edgeGestureBound) return;
  page.dataset.edgeGestureBound = "1";
  let edgePointer = null; let edgeStartX = 0; let edgeStartY = 0; let edgeActive = false;
  page.addEventListener("pointerdown", (event) => {
    if (event.clientX > 24 || event.target.closest("textarea,input,.msg,button")) return;
    edgePointer = event.pointerId; edgeStartX = event.clientX; edgeStartY = event.clientY; edgeActive = true;
  });
  page.addEventListener("pointermove", (event) => {
    if (!edgeActive || edgePointer !== event.pointerId) return;
    const dx = event.clientX - edgeStartX; const dy = event.clientY - edgeStartY;
    if (Math.abs(dy) > Math.max(18, dx)) { edgeActive = false; page.style.transform = ""; return; }
    if (dx > 0) page.style.transform = `translate3d(${Math.min(92, dx * .72)}px,0,0)`;
  });
  const finishEdge = (event) => {
    if (!edgeActive || edgePointer !== event.pointerId) return;
    const dx = event.clientX - edgeStartX;
    page.style.transform = ""; edgeActive = false; edgePointer = null;
    const target = gestureBackTarget();
    if (dx > 72 && target && allowNavigation()) transitionRender(() => { state.view = target; state.dirty = false; }, "back");
  };
  page.addEventListener("pointerup", finishEdge);
  page.addEventListener("pointercancel", () => { page.style.transform = ""; edgeActive = false; edgePointer = null; });
}

function bindChatVirtualizer() {
  const messages = root.querySelector(".msgs");
  if (!messages || messages.dataset.virtualBound) return;
  messages.dataset.virtualBound = "1";
  let frame = 0;
  const loadOlder = () => {
    const current = Number(state.chatWindowStart || 0);
    if (!current) return;
    const anchorIndex = current;
    const oldAnchorTop = messages.querySelector(`[data-message-index="${anchorIndex}"]`)?.getBoundingClientRect().top;
    state.chatWindowStart = Math.max(0, current - CHAT_WINDOW_CHUNK);
    const status = state.busy ? thinkingMarkup() : state.fallbackNotice ? `<div class="fallback-notice">${esc(state.fallbackNotice)}</div>` : "";
    const start = state.chatWindowStart;
    messages.innerHTML = `${start ? `<div class="chat-window-spacer" data-chat-spacer style="height:${start * 82}px"><button type="button" data-load-older>查看更早的 ${start} 条消息</button></div>` : ""}${state.turns.slice(start).map((turn, offset) => messageMarkup(turn, start + offset)).join("")}${status}${voiceStatusMarkup()}${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}`;
    bindMessageInteractions(messages);
    bindChatGestures();
    messages.querySelector("[data-load-older]")?.addEventListener("click", loadOlder);
    const newAnchorTop = messages.querySelector(`[data-message-index="${anchorIndex}"]`)?.getBoundingClientRect().top;
    if (Number.isFinite(oldAnchorTop) && Number.isFinite(newAnchorTop)) messages.scrollTop += newAnchorTop - oldAnchorTop;
  };
  messages.querySelector("[data-load-older]")?.addEventListener("click", loadOlder);
  messages.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const spacer = messages.querySelector("[data-chat-spacer]");
      if (spacer && messages.scrollTop < spacer.offsetHeight + 260) loadOlder();
    });
  }, { passive: true });
}

function bindGroupVirtualizer() {
  const messages = root.querySelector(".group-msgs");
  if (!messages || messages.dataset.virtualBound) return;
  messages.dataset.virtualBound = "1";
  let frame = 0;
  const loadOlder = () => {
    const current = Number(state.groupWindowStart || 0);
    if (!current) return;
    const oldAnchorTop = messages.querySelector(`[data-group-turn="${current}"]`)?.getBoundingClientRect().top;
    state.groupWindowStart = Math.max(0, current - CHAT_WINDOW_CHUNK);
    const start = state.groupWindowStart;
    messages.innerHTML = `${start ? `<div class="chat-window-spacer" data-group-spacer style="height:${start * 76}px"><button type="button" data-load-older-group>查看更早的 ${start} 条消息</button></div>` : ""}${state.groupTurns.slice(start).map((turn, offset) => groupMessageMarkup(turn, start + offset)).join("")}${state.busy ? `<div class="group-typing"><i></i><i></i><i></i><span>正在判断由谁回应</span></div>` : ""}${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}`;
    messages.querySelector("[data-load-older-group]")?.addEventListener("click", loadOlder);
    const newAnchorTop = messages.querySelector(`[data-group-turn="${current}"]`)?.getBoundingClientRect().top;
    if (Number.isFinite(oldAnchorTop) && Number.isFinite(newAnchorTop)) messages.scrollTop += newAnchorTop - oldAnchorTop;
  };
  messages.querySelector("[data-load-older-group]")?.addEventListener("click", loadOlder);
  messages.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const spacer = messages.querySelector("[data-group-spacer]");
      if (spacer && messages.scrollTop < spacer.offsetHeight + 240) loadOlder();
    });
  }, { passive: true });
}
function keepChatAtBottom(container, force = false) {
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180;
  if (force || nearBottom) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}
function appendChatMessage(turn, index) {
  const messages = root.querySelector(".msgs");
  if (!messages) return;
  messages.querySelector(".generation-status, .fallback-notice, .error")?.remove();
  const previous = state.turns[index - 1];
  if (previous?.role === turn.role && Number(turn.createdAt) - Number(previous.createdAt) < 120000) {
    const previousMessage = messages.querySelector(`[data-message-index="${index - 1}"]`)?.closest(".message-wrap");
    previousMessage?.classList.remove("group-end");
    previousMessage?.querySelector(".message-avatar")?.classList.add("placeholder");
    if (previousMessage?.querySelector(".message-avatar")) previousMessage.querySelector(".message-avatar").textContent = "";
  }
  messages.insertAdjacentHTML("beforeend", messageMarkup(turn, index));
  bindMessageInteractions(messages.lastElementChild);
  keepChatAtBottom(messages, turn.role === "user");
}
function syncChatGeneration() {
  const messages = root.querySelector(".msgs");
  if (!messages) return;
  messages.querySelectorAll(".generation-status, .fallback-notice, .error").forEach((node) => node.remove());
  if (state.busy) messages.insertAdjacentHTML("beforeend", thinkingMarkup());
  else if (state.fallbackNotice) messages.insertAdjacentHTML("beforeend", `<div class="fallback-notice">${esc(state.fallbackNotice)}</div>`);
  if (state.error) messages.insertAdjacentHTML("beforeend", `<div class="error">${esc(state.error)}</div>`);
  const input = root.querySelector("#message");
  const submit = root.querySelector('#send button[type="submit"]');
  if (input) { input.disabled = state.busy; input.placeholder = state.busy ? "正在回应…" : "说点什么…"; }
  if (submit) submit.disabled = state.busy;
  root.querySelector("[data-stop-generation]")?.addEventListener("click", stopGeneration);
  keepChatAtBottom(messages);
}
function syncVoiceGeneration() {
  const messages = root.querySelector(".msgs");
  if (!messages) return;
  const existing = messages.querySelector(".voice-pill");
  if (!state.speaking) existing?.remove();
  else if (existing) { const label = existing.querySelector("b"); if (label) label.textContent = state.voicePhase || "正在生成声音"; }
  else messages.insertAdjacentHTML("beforeend", voiceStatusMarkup());
  root.querySelector("[data-stop-voice]")?.addEventListener("click", stopVoice);
  keepChatAtBottom(messages);
}
function settings() {
  return shell(`<main class="wizard"><button data-go="home" class="back">← 返回</button><section class="panel"><div class="step-icon">⌁</div><h2>连接设置</h2><p>聊天和趣味玩法使用豆包，语音克隆与播放需要连接语音服务器。</p><label>火山方舟 API Key<input id="apiKey" type="password" value="${esc(state.settings.key)}" placeholder="方舟 API Key"></label><label>电脑服务地址<input id="computer" value="${esc(state.settings.computer)}" placeholder="https://arichm.dpdns.org"></label><button class="primary full" data-save-settings>保存设置</button></section></main>`);
}
function decorateEcho() {
  const echo = root.querySelector(".echo");
  if (!echo) return;
  const phrasePool = [
    "吃饭了吗", "想你了", "早点休息", "记得带伞", "今天好吗", "别熬夜", "一路平安", "我在听", "等你回来", "别忘了哦",
    "明天见", "到家了吗", "多穿一点", "记得喝水", "睡个好觉", "慢慢来", "别担心", "我一直在", "今天辛苦了", "路上小心",
    "有空回我", "别太累了", "好好吃饭", "天气变凉了", "醒了吗", "早点回来", "照顾好自己", "晚点聊", "别怕", "会好的",
    "我懂", "想和你说说话", "今天也要开心", "等你的消息", "早上好呀", "晚安好梦", "刚忙完吗", "现在方便吗", "在干什么呢", "今天顺利吗",
    "工作结束了吗", "下班了吗", "周末见吧", "有点想你", "记得想我", "我等着你", "慢点走", "不用着急", "安全到家", "到了说一声",
    "别淋雨了", "外面冷吗", "今天降温", "记得添衣", "太阳很好", "出去走走", "抬头看看天", "风有点大", "今晚有月亮", "记得看晚霞",
    "早餐吃了吗", "午饭吃什么", "晚饭想吃啥", "别饿着自己", "多吃一点", "少喝冰的", "记得吃水果", "给你留了饭", "想吃火锅吗", "一起喝奶茶",
    "今天开心吗", "发生什么了", "可以告诉我", "我陪着你", "抱抱你", "别难过啦", "都会过去的", "你已经很好了", "不怪你", "别责怪自己",
    "休息一下吧", "先缓一缓", "深呼吸一下", "不用逞强", "累了就停停", "别给自己压力", "今天就到这里", "明天再继续", "你做得很好", "为你开心",
    "刚刚想到你", "突然想见你", "听到一首歌", "看到好看的云", "路过熟悉的地方", "想起那一天", "记得我们的约定", "你还记得吗", "有件事想告诉你", "留句话给你",
    "收到请回答", "看到回一下", "忙完找我", "空了聊聊", "我没有走", "一直都在", "随时找我", "不用客气", "别和我见外", "有我呢",
    "今天很棒", "保持好心情", "祝你顺利", "愿你开心", "一切顺心", "好运正在来", "会有好事发生", "今天也加油", "你可以的", "相信自己",
    "早点睡觉", "手机放下啦", "被子盖好", "别踢被子", "做个好梦", "醒来见", "明早叫你", "睡醒告诉我", "今晚别想太多", "明天会更好",
    "周末怎么过", "最近忙什么", "好久没聊了", "什么时候见面", "一起吃饭吧", "有空散散步", "想去看电影", "下次带上我", "说好了哦", "不许反悔",
    "笑一个嘛", "别皱眉啦", "给你加加油", "偷偷关心你", "今天也想念", "给你一个拥抱", "愿你被温柔对待", "希望你一切都好", "记得照顾心情", "期待下次见面",
    "我来啦", "还没睡吗", "你在就好", "听你慢慢说", "不用马上回复", "想说就说吧", "安静陪你一会", "今天有想我吗", "留盏灯等你", "回头我还在"
  ];
  const selectedPhrases = [...phrasePool].sort(() => Math.random() - .5).slice(0, 17);
  selectedPhrases.forEach((text) => {
    const whisper = document.createElement("span");
    whisper.textContent = text;
    echo.appendChild(whisper);
  });
  [...echo.querySelectorAll(":scope > span")].forEach((bubble, index) => {
    const directionX = index % 2 ? -1 : 1;
    const directionY = index % 3 ? -1 : 1;
    bubble.style.setProperty("--mx", `${directionX * (8 + Math.random() * 8).toFixed(1)}px`);
    bubble.style.setProperty("--my", `${directionY * (6 + Math.random() * 7).toFixed(1)}px`);
    bubble.style.setProperty("--tilt", `${(-6 + Math.random() * 12).toFixed(1)}deg`);
    bubble.style.animationDuration = `${(8.4 + Math.random() * 5.8).toFixed(2)}s`;
    bubble.style.animationDelay = `${(-Math.random() * 13).toFixed(2)}s`;
  });
  let phraseCursor = 17;
  const rotatePhrases = setInterval(() => {
    if (!echo.isConnected) return clearInterval(rotatePhrases);
    const bubbles = [...echo.querySelectorAll(":scope > span")];
    const bubble = bubbles[Math.floor(Math.random() * bubbles.length)];
    const used = new Set(bubbles.map((item) => item.textContent));
    const next = [...phrasePool.slice(phraseCursor), ...phrasePool.slice(0, phraseCursor)].find((text) => !used.has(text));
    if (bubble && next) {
      bubble.textContent = next;
      phraseCursor = (phrasePool.indexOf(next) + 1) % phrasePool.length;
    }
  }, 3200);
  const effects = document.createElement("div");
  effects.className = "orb-effects";
  effects.innerHTML = `<i class="scan"></i><i class="energy"></i>${Array.from({length: 14}, (_, i) => `<b style="--particle:${i}"></b>`).join("")}`;
  echo.appendChild(effects);
  const core = document.createElement("div");
  core.className = "living-core";
  core.innerHTML = `<i class="core-aurora"></i><i class="core-caustic"></i><i class="core-glint"></i>`;
  echo.appendChild(core);
  startOrbLife(core);
  const settings = document.createElement("button");
  settings.className = "home-settings";
  settings.dataset.go = "settings";
  settings.setAttribute("aria-label", "设置");
  settings.innerHTML = "<i></i>";
  root.querySelector(".home .hero")?.prepend(settings);
}
function startOrbLife(core) {
  const started = performance.now();
  const phase = Math.random() * Math.PI * 2;
  let dragging = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let originX = 0;
  let originY = 0;
  let dragX = 0;
  let dragY = 0;
  let targetX = 0;
  let targetY = 0;
  let velocityX = 0;
  let velocityY = 0;
  const clampDrag = (value) => Math.max(-92, Math.min(92, value));
  core.addEventListener("pointerdown", (event) => {
    dragging = true;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    originX = targetX;
    originY = targetY;
    velocityX = velocityY = 0;
    core.classList.add("is-dragging");
    core.setPointerCapture(event.pointerId);
  });
  core.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const nextX = clampDrag(originX + event.clientX - pointerStartX);
    const nextY = clampDrag(originY + event.clientY - pointerStartY);
    velocityX = (nextX - targetX) * .32;
    velocityY = (nextY - targetY) * .32;
    targetX = nextX;
    targetY = nextY;
  });
  const release = (event) => {
    if (!dragging) return;
    dragging = false;
    targetX = targetY = 0;
    core.classList.remove("is-dragging");
    if (core.hasPointerCapture(event.pointerId)) core.releasePointerCapture(event.pointerId);
  };
  core.addEventListener("pointerup", release);
  core.addEventListener("pointercancel", release);
  const move = (now) => {
    if (!core.isConnected) return;
    if (document.hidden) { requestAnimationFrame(move); return; }
    const t = (now - started) / 1000;
    if (dragging) {
      dragX += (targetX - dragX) * .34;
      dragY += (targetY - dragY) * .34;
    } else {
      velocityX = (velocityX - dragX * .038) * .88;
      velocityY = (velocityY - dragY * .038) * .88;
      dragX += velocityX;
      dragY += velocityY;
    }
    const x = Math.sin(t * .71 + phase) * 9 + Math.sin(t * 1.37 + .8) * 4 + Math.sin(t * .19) * 3;
    const y = Math.sin(t * .83 + phase * .4) * 11 + Math.sin(t * 1.61) * 4 - 5;
    const sx = 1 + Math.sin(t * .93 + .3) * .055 + Math.sin(t * 1.83) * .018;
    const sy = 1 + Math.sin(t * .79 + 1.7) * .06 - Math.sin(t * 1.83) * .014;
    const angle = Math.sin(t * .47 + phase) * 4 + Math.sin(t * 1.11) * 1.5;
    const glow = .72 + (Math.sin(t * .67) + Math.sin(t * 1.31 + 1.2) + 2) * .1;
    core.style.transform = `translate3d(${(x + dragX).toFixed(2)}px,${(y + dragY).toFixed(2)}px,0) rotate(${angle.toFixed(2)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
    core.style.setProperty("--life-glow", glow.toFixed(3));
    core.style.setProperty("--aurora-x", `${(50 + Math.sin(t * .53) * 22).toFixed(1)}%`);
    core.style.setProperty("--aurora-y", `${(42 + Math.sin(t * .41 + 1.2) * 19).toFixed(1)}%`);
    core.style.setProperty("--glint-x", `${(27 + Math.sin(t * .37 + phase) * 10 + Math.sin(t * 1.09) * 4).toFixed(1)}px`);
    core.style.setProperty("--glint-y", `${(21 + Math.sin(t * .43 + phase * .7) * 8 + Math.sin(t * 1.27 + .8) * 3).toFixed(1)}px`);
    core.style.setProperty("--glint-scale", (0.72 + (Math.sin(t * .61 + .4) + 1) * .23).toFixed(3));
    core.style.setProperty("--glint-alpha", (0.42 + (Math.sin(t * .77 + phase) + 1) * .25).toFixed(3));
    requestAnimationFrame(move);
  };
  requestAnimationFrame(move);
}

let renderedView = "";
function captureRenderState() {
  const active = document.activeElement;
  const field = active?.matches?.("textarea,input") ? active : root.querySelector("#message,#group-message");
  const scroller = root.querySelector(".msgs,.group-msgs,.library-list,.memory-content,.wizard");
  return {
    fieldId: field?.id || "",
    value: field?.value,
    selectionStart: field?.selectionStart,
    selectionEnd: field?.selectionEnd,
    focused: active === field,
    voiceMode: root.querySelector("#send")?.classList.contains("voice-mode") || false,
    scrollTop: scroller?.scrollTop || 0,
    bottomGap: scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : 0,
    scrollerClass: scroller?.classList?.[0] || ""
  };
}

function restoreRenderState(snapshot) {
  if (!snapshot) return;
  const field = snapshot.fieldId ? root.querySelector(`#${snapshot.fieldId}`) : null;
  if (field && typeof snapshot.value === "string") {
    field.value = snapshot.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    if (snapshot.focused) {
      field.focus({ preventScroll: true });
      try { field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd); } catch {}
    }
  }
  if (snapshot.voiceMode) root.querySelector("#send")?.classList.add("voice-mode");
  const scroller = snapshot.scrollerClass ? root.querySelector(`.${snapshot.scrollerClass}`) : null;
  if (scroller) {
    scroller.scrollTop = snapshot.bottomGap < 120
      ? scroller.scrollHeight
      : Math.min(snapshot.scrollTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
  }
}

function render() {
  const sameView = renderedView === state.view;
  const snapshot = sameView ? captureRenderState() : null;
  viewRoot.innerHTML = state.view === "playground" ? shell(`<main id="playground-host" class="playground"></main>`) : state.view === "home" ? home() : state.view === "library" ? library() : state.view === "profile" ? profile() : state.view === "album" ? lifeAlbum() : state.view === "memory" ? memoryCenter() : state.view === "proactive" ? proactiveSettings() : state.view === "versions" ? versionCenter() : state.view === "wizard" ? wizard() : state.view === "chat" ? chat() : state.view === "groupSetup" ? groupSetup() : state.view === "groupChat" ? groupChat() : state.view === "incremental" ? incrementalLearning() : settings();
  if (state.view === "proactive") decorateReminderSettings();
  if (state.view === "groupChat") root.querySelector(".group-chat .chathead")?.insertAdjacentHTML("afterend", `<div class="group-auto-bar"><button data-group-auto class="${state.groupAutoRunning ? "active" : ""}"><i></i><span>${state.groupAutoRunning ? "停止自由聊天" : "让他们聊聊"}</span></button><small data-group-auto-status>${esc(state.groupAutoStatus || "他们会慢慢接话，也可能暂时沉默")}</small></div>`);
  if (state.view === "home" || state.view === "library") {
    const entry = `<button class="play-launch" data-go="playground"><span><b>✦ 回声游乐场</b><small>朋友圈 · 小事法庭 · 脑内董事会</small></span><em>↗</em></button>`;
    root.querySelector(state.view === "home" ? ".home-library" : ".library-tools")?.insertAdjacentHTML("afterend", entry);
  }
  if (state.view === "playground") {
    const host = root.querySelector("#playground-host");
    host.addEventListener("play-exit", () => transitionRender(() => {state.view = "home";}, "back"));
    playground.mount(host);
  }
  syncDock();
  decorateEcho();
  bind();
  renderedView = state.view;
  if (state.view === "chat") { bindMessageInteractions(); bindChatVirtualizer(); bindChatGestures(); }
  if (state.view === "groupChat") { bindChatGestures(); bindGroupVirtualizer(); }
  requestAnimationFrame(() => {
    if (sameView) restoreRenderState(snapshot);
    else if (state.view === "chat" || state.view === "groupChat") {
      const el = root.querySelector(state.view === "chat" ? ".msgs" : ".group-msgs");
      if (el) el.scrollTop = el.scrollHeight;
    }
  });
}
function transitionRender(mutate, direction = "forward") {
  document.documentElement.dataset.navDirection = direction;
  const update = () => { mutate(); render(); };
  if (document.startViewTransition) document.startViewTransition(update).finished.finally(() => delete document.documentElement.dataset.navDirection);
  else { update(); delete document.documentElement.dataset.navDirection; }
}
function bind() {
  root.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", async () => {
    await toggleTheme();
    syncThemeControls();
  }));
  const profileOrb = root.querySelector(".profile-orb");
  if (profileOrb) {
    const profileAvatar = profileOrb.querySelector("b");
    if (profileAvatar && state.active?.avatar) { profileAvatar.style.cssText = avatarStyle(state.active); profileAvatar.textContent = ""; }
    if (!root.querySelector("#agentAvatarFile")) profileOrb.insertAdjacentHTML("afterend", `<label class="profile-avatar-edit">更换头像<input id="agentAvatarFile" type="file" accept="image/*"></label>`);
  }
  root.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => {
    if (!allowNavigation()) return;
    if (state.groupAutoRunning && b.dataset.go !== "groupChat") stopAutonomousGroupChat();
    transitionRender(() => { state.view = b.dataset.go; state.deleteIndex = null; state.dirty = false; }, "back");
  });
  const chatBack = root.querySelector(".chathead [data-go='home']");
  if (chatBack) chatBack.onclick = async () => { if (state.callActive) { minimizeCall(); return; } transitionRender(() => { state.view = "library"; }, "back"); };
  root.querySelectorAll("[data-create]").forEach((b) => b.onclick = () => transitionRender(() => { const id = String(Date.now()); state.view = "wizard"; state.step = 1; state.draft = { log: "", name: "", relation: "", voice: false, mode: "fast", voiceId: id, agentId: id, detected: "", trainingStatus: "idle", trainingPhase: "" }; }));
  root.querySelector("#log")?.addEventListener("input", (e) => {
    state.draft.log = e.target.value;
    state.dirty = true;
    const count = root.querySelector(".under span");
    const next = root.querySelector("[data-next]");
    if (count) count.textContent = `${state.draft.log.length} 字`;
    if (next) next.disabled = state.draft.log.length < 20;
  });
  root.querySelector("[data-sample]")?.addEventListener("click", () => { state.draft.log = sample; state.dirty = true; render(); });
  root.querySelector("#name")?.addEventListener("input", (e) => {
    state.draft.name = e.target.value;
    state.dirty = true;
    const next = root.querySelector("[data-next]");
    if (next) next.disabled = !state.draft.name.trim();
  });
  root.querySelector("#relation")?.addEventListener("input", (e) => { state.draft.relation = e.target.value; state.dirty = true; });
  root.querySelectorAll("[data-voice]").forEach((b) => b.onclick = async () => {
    const enabled = b.dataset.voice === "true";
    if (!enabled && state.draft.voiceRecording) {
      clearInterval(voiceSampleTimer); voiceSampleTimer = null;
      try { await EchoSpeech.cancelVoiceSampleRecording(); } catch {}
      state.draft.voiceRecording = false;
    }
    state.draft.voice = enabled; render();
  });
  root.querySelector("[data-record-voice]")?.addEventListener("click", toggleVoiceSampleRecording);
  root.querySelector("[data-rerecord-voice]")?.addEventListener("click", () => { state.draft.recordedAudio = ""; state.draft.voiceStatus = ""; render(); });
  root.querySelector("[data-confirm-recording]")?.addEventListener("click", confirmRecordedVoice);
  root.querySelector("#voiceFile")?.addEventListener("change", uploadVoice);
  root.querySelector("#agentAvatarFile")?.addEventListener("change", uploadAgentAvatar);
  root.querySelector("#chatImageFile")?.addEventListener("change", selectChatImage);
  root.querySelector("[data-remove-image]")?.addEventListener("click", () => { state.pendingImage = null; render(); });
  root.querySelector("[data-next]")?.addEventListener("click", advanceWizard);
  root.querySelector("[data-back]")?.addEventListener("click", () => { if (!allowNavigation()) return; transitionRender(() => { if (state.step > 1) state.step--; else state.view = "home"; }, "back"); });
  root.querySelector("[data-finish]")?.addEventListener("click", finishWizard);
  root.querySelectorAll("[data-agent]").forEach((b) => b.onclick = () => {
    b.querySelector("i")?.style.setProperty("view-transition-name", "active-agent-avatar");
    openAgent(state.agents[+b.dataset.agent], true);
  });
  root.querySelector("[data-new-group]")?.addEventListener("click", () => transitionRender(() => state.view = "groupSetup"));
  root.querySelector("[data-invite-agent]")?.addEventListener("click", () => transitionRender(() => { state.groupSeedId = state.active?.id; state.view = "groupSetup"; }));
  root.querySelector("[data-create-group]")?.addEventListener("click", createGroup);
  root.querySelector("[data-manage-group]")?.addEventListener("click", () => transitionRender(() => { state.groupEditing = true; state.view = "groupSetup"; }));
  root.querySelector("[data-delete-group]")?.addEventListener("click", deleteGroup);
  root.querySelectorAll("[data-group]").forEach((button) => button.addEventListener("click", () => openGroup(state.groups[+button.dataset.group])));
  root.querySelector("#group-send")?.addEventListener("submit", sendGroupMessage);
  root.querySelector("#groupImageFile")?.addEventListener("change", selectGroupImage);
  root.querySelector("[data-remove-group-image]")?.addEventListener("click", () => { state.pendingGroupImage = null; render(); });
  root.querySelector("[data-group-auto]")?.addEventListener("click", () => state.groupAutoRunning ? stopAutonomousGroupChat() : startAutonomousGroupChat());
  root.querySelectorAll("[data-detail]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); transitionRender(() => { state.active = state.agents[+b.dataset.detail]; state.view = "profile"; }); });
  root.querySelector("[data-open-chat]")?.addEventListener("click", () => openAgent(state.active));
  root.querySelector("[data-delete-active]")?.addEventListener("click", () => { state.deleteIndex = state.agents.indexOf(state.active); render(); });
  root.querySelectorAll("[data-delete]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); state.deleteIndex = +b.dataset.delete; render(); });
  root.querySelector("[data-cancel-delete]")?.addEventListener("click", () => { state.deleteIndex = null; render(); });
  root.querySelector("[data-confirm-delete]")?.addEventListener("click", deleteAgent);
  root.querySelector("#send")?.addEventListener("submit", send);
  const composerInput = root.querySelector("#message");
  composerInput?.addEventListener("input", () => {
    composerInput.style.height = "auto";
    composerInput.style.height = `${Math.min(composerInput.scrollHeight, 116)}px`;
    root.querySelector("#send")?.classList.toggle("has-text", Boolean(composerInput.value.trim() || state.pendingImage));
  });
  root.querySelector("[data-voice-mode]")?.addEventListener("click", () => {
    const form = root.querySelector("#send");
    const talking = root.querySelector("[data-hold-talk]");
    const voiceMode = !form?.classList.contains("voice-mode");
    form?.classList.toggle("voice-mode", voiceMode);
    if (composerInput) composerInput.hidden = voiceMode;
    if (talking) talking.hidden = !voiceMode;
  });
  bindHoldToTalk(root.querySelector("[data-hold-talk]"));
  root.querySelector("[data-cancel-recording]")?.addEventListener("click", cancelVoiceInput);
  root.querySelector("[data-stop-generation]")?.addEventListener("click", stopGeneration);
  root.querySelector("[data-stop-voice]")?.addEventListener("click", stopVoice);
  root.querySelector("[data-mute-once]")?.addEventListener("click", (event) => {
    state.muteOnce = !state.muteOnce;
    event.currentTarget.classList.toggle("active", state.muteOnce);
    event.currentTarget.textContent = state.muteOnce ? "静" : "声";
  });
  root.querySelector("[data-start-call]")?.addEventListener("click", showCallConfirmation);
  bindCallControls();
  root.querySelector("[data-check-connection]")?.addEventListener("click", () => checkComputerConnection());
  root.querySelector("#memory-form")?.addEventListener("submit", addMemory);
  root.querySelectorAll("[data-delete-memory]").forEach((button) => button.addEventListener("click", () => deleteMemory(button.dataset.deleteMemory, button.dataset.layer)));
  root.querySelector("[data-proactive-toggle]")?.addEventListener("change", toggleProactive);
  root.querySelector("[data-save-proactive]")?.addEventListener("click", saveProactiveSettings);
  root.querySelectorAll("#proactive-frequency,#quiet-start,#quiet-end,#proactive-style").forEach((input) => input.addEventListener("change", () => { state.dirty = true; }));
  root.querySelectorAll("[data-cancel-reminder]").forEach((button) => button.addEventListener("click", () => cancelReminder(Number(button.dataset.cancelReminder))));
  root.querySelectorAll("[data-memory-tab]").forEach((button) => button.addEventListener("click", () => { state.memoryTab = button.dataset.memoryTab; render(); }));
  root.querySelectorAll("[data-memory-accept]").forEach((button) => button.addEventListener("click", () => acceptPendingMemory(button.dataset.memoryAccept)));
  root.querySelectorAll("[data-memory-edit]").forEach((button) => button.addEventListener("click", () => editPendingMemory(button.dataset.memoryEdit)));
  root.querySelectorAll("[data-event-status]").forEach((select) => select.addEventListener("change", () => setEventStatus(select.dataset.eventStatus, select.value)));
  root.querySelector("[data-incremental]")?.addEventListener("click", () => transitionRender(() => state.view = "incremental"));
  root.querySelector("#incremental-log")?.addEventListener("input", (event) => { state.dirty = !!event.target.value.trim(); updateIncrementalPreview(event); });
  root.querySelector("[data-apply-incremental]")?.addEventListener("click", applyIncrementalLearning);
  root.querySelector("[data-rollback-training]")?.addEventListener("click", rollbackTrainingVersion);
  root.querySelectorAll("[data-rollback-version]").forEach((button) => button.addEventListener("click", () => rollbackTrainingVersion(button.dataset.rollbackVersion)));
  root.querySelector("[data-save-settings]")?.addEventListener("click", saveSettings);
}
async function finishWizard() {
  state.draft.mode = "fast";
  const a = normalizeAgent({ ...state.draft, memories: [], id: state.draft.agentId || String(Date.now()) });
  state.agents.push(a);
  await saveAgents();
  openAgent(a);
}
function advanceWizard() {
  if (state.step === 1) inferAgentProfile();
  transitionRender(() => state.step++);
}
function inferAgentProfile() {
  const labels = [...String(state.draft.log || "").matchAll(/^\s*([^：:\n]{1,16})[：:]/gm)].map((match) => match[1].trim());
  const counts = new Map();
  for (const label of labels) {
    if (/^(我|本人|自己|me)$/i.test(label)) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const detected = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  if (detected && !state.draft.name) state.draft.name = detected;
  state.draft.detected = detected;
  if (!state.draft.relation) {
    const source = `${detected} ${state.draft.log}`;
    state.draft.relation = /妈妈|妈咪|母亲/.test(source) ? "家人 · 妈妈" : /爸爸|老爸|父亲/.test(source) ? "家人 · 爸爸" : /姐姐|哥哥|弟弟|妹妹|爷爷|奶奶|外婆|外公/.test(source) ? "家人" : /同事|领导|老板|工作/.test(source) ? "同事" : /宝贝|宝宝|老婆|老公|亲爱的/.test(source) ? "伴侣" : "朋友";
  }
}
async function checkComputerConnection(renderUI = true) {
  state.connection = "checking";
  syncConnectionBadge();
  try {
    const response = await CapacitorHttp.get({
      url: `${state.settings.computer.replace(/\/$/, "")}/health`,
      headers: { ...bridgeHeaders(), "Cache-Control": "no-cache, no-store", Pragma: "no-cache", "X-Echo-Probe": String(Date.now()) },
      connectTimeout: 3500, readTimeout: 3500
    });
    const health = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    state.connection = response.status === 200 && health?.ok === true && health?.service === "echo-computer-bridge" && health?.protected === true ? "online" : "offline";
    state.connectionCheckedAt = Date.now();
  } catch { state.connection = "offline"; }
  syncConnectionBadge();
  return state.connection === "online";
}

function syncConnectionBadge() {
  const badge = root.querySelector(".connection-badge");
  if (!badge) return;
  const text = state.connection === "online" ? "服务器在线" : state.connection === "offline" ? "服务器离线" : "正在检测服务器";
  badge.className = `connection-badge ${state.connection}`;
  const label = badge.lastChild;
  if (label?.nodeType === Node.TEXT_NODE) label.textContent = text;
}
async function addMemory(event) {
  event.preventDefault();
  const text = root.querySelector("#memory-input")?.value.trim();
  if (!text || !state.active) return;
  state.active.memories ||= [];
  state.active.memories.unshift({ id: String(Date.now()), text, createdAt: Date.now(), source: "manual", locked: true });
  state.active.memories = state.active.memories.slice(0, 30);
  await saveAgents(); render();
}
async function deleteMemory(id, layer = "long") {
  if (!state.active) return;
  const key = layer === "pending" ? "pendingMemories" : layer === "episode" ? "episodicMemories" : "memories";
  state.active[key] = (state.active[key] || []).filter((item) => String(item.id) !== String(id));
  await saveAgents(); render();
}
async function rememberFromMessage(text) {
  if (!state.active) return;
  const clean = String(text).replace(/\s+/g, " ").trim();
  const important = /(我叫|我是|我喜欢|我不喜欢|我爱|我讨厌|我住在|我在.+工作|我的生日|记住|别忘了|以后叫我)/.test(clean);
  const episodic = /(今天|昨天|明天|今晚|周末|下周|下个月|刚刚|等会|之后|考试|出差|约好|计划|要去|准备)/.test(clean);
  if ((!important && !episodic) || clean.length > 120) return;
  const all = [...(state.active.pendingMemories || []), ...(state.active.episodicMemories || []), ...(state.active.memories || [])];
  if (all.some((item) => item.text === clean)) return;
  state.active.pendingMemories ||= [];
  state.active.pendingMemories.unshift({ id: `p-${Date.now()}`, text: clean, createdAt: Date.now(), suggestedLayer: episodic && !important ? "episode" : "long", status: episodic ? "planned" : "confirmed", source: "chat" });
  state.active.pendingMemories = state.active.pendingMemories.slice(0, 30);
}
async function acceptPendingMemory(id) {
  const item = (state.active?.pendingMemories || []).find((entry) => String(entry.id) === String(id));
  if (!item) return;
  const episode = item.suggestedLayer === "episode";
  const key = episode ? "episodicMemories" : "memories";
  state.active[key] ||= [];
  state.active[key].unshift({ ...item, id: `${episode ? "e" : "m"}-${Date.now()}`, automatic: false, locked: !episode, status: episode ? (item.status || "planned") : undefined });
  state.active.pendingMemories = state.active.pendingMemories.filter((entry) => entry !== item);
  state.active.relationship.confirmedMemoryCount = Number(state.active.relationship.confirmedMemoryCount || 0) + 1;
  updateRelationship(state.active, 0); await saveAgents(); render();
}
async function editPendingMemory(id) {
  const item = (state.active?.pendingMemories || []).find((entry) => String(entry.id) === String(id));
  if (!item) return;
  const value = window.prompt("修改这条记忆", item.text)?.trim();
  if (!value) return;
  item.text = value.slice(0, 120); await saveAgents(); render();
}
async function setEventStatus(id, status) {
  const item = (state.active?.episodicMemories || []).find((entry) => String(entry.id) === String(id));
  if (!item) return;
  item.status = status; item.statusUpdatedAt = Date.now(); await saveAgents(); render();
}

function relationshipStage(agent) {
  const score = Number(agent?.relationship?.score || 0);
  return score >= 80 ? "彼此依赖" : score >= 58 ? "亲密" : score >= 34 ? "熟悉" : score >= 16 ? "渐渐了解" : "初识";
}
function currentEmotion(agent, mutate = false) {
  const source = agent?.emotion || {};
  const hours = Math.max(0, (Date.now() - Number(source.updatedAt || Date.now())) / 3600000);
  const fade = Math.min(1, hours / 72);
  const value = {
    warmth: Math.round(Number(source.warmth ?? 52) * (1 - fade) + 52 * fade),
    energy: Math.round(Number(source.energy ?? 55) * (1 - fade) + 55 * fade),
    concern: Math.round(Number(source.concern ?? 12) * (1 - fade) + 12 * fade),
    closeness: Math.round(Number(source.closeness ?? 24) * (1 - fade) + 24 * fade),
    updatedAt: Date.now(), reason: source.reason || "自然平静"
  };
  if (mutate && agent) agent.emotion = value;
  return value;
}
function emotionLabel(agent) {
  const e = currentEmotion(agent);
  if (e.concern >= 58) return "有些担心你";
  if (e.energy <= 30) return "安静陪伴";
  if (e.warmth >= 72 && e.closeness >= 55) return "温暖亲近";
  if (e.energy >= 72) return "轻快活跃";
  return "平静温和";
}
function updateEmotion(agent, text, role = "user") {
  if (!agent) return;
  const e = currentEmotion(agent);
  const value = String(text || "");
  const positive = /(开心|高兴|谢谢|喜欢|爱你|哈哈|真好|顺利|太棒)/.test(value);
  const vulnerable = /(难过|累|失眠|害怕|焦虑|生病|不舒服|想哭|压力|烦)/.test(value);
  const distant = /(别烦|不想聊|闭嘴|讨厌|滚|别联系)/.test(value);
  const caring = /(想你|关心|晚安|早安|吃饭|休息|保重)/.test(value);
  if (role === "user") {
    e.warmth += positive ? 6 : caring ? 4 : distant ? -9 : 1;
    e.energy += positive ? 7 : vulnerable ? -5 : distant ? -6 : 0;
    e.concern += vulnerable ? 18 : distant ? 5 : positive ? -5 : -1;
    e.closeness += caring ? 5 : positive ? 3 : distant ? -6 : 1;
    e.reason = vulnerable ? "注意到你似乎不太舒服" : distant ? "感受到你现在想要空间" : positive ? "被你轻松的情绪感染" : caring ? "感受到你的关心" : "延续刚才的交流";
  }
  for (const key of ["warmth", "energy", "concern", "closeness"]) e[key] = Math.max(0, Math.min(100, Math.round(e[key])));
  e.updatedAt = Date.now(); agent.emotion = e;
}
function emotionPrompt(agent) {
  const e = currentEmotion(agent);
  return `当前内在状态：${emotionLabel(agent)}（温暖${e.warmth}/100、精力${e.energy}/100、担忧${e.concern}/100、亲近${e.closeness}/100）。只通过语气轻微体现，不直说数值、不情绪勒索、不责怪用户。`;
}
function lastContactText(agent) {
  const stamp = Number(agent?.relationship?.lastContactAt || 0);
  if (!stamp) return "还没有开始连续对话";
  const diff = Date.now() - stamp;
  if (diff < 3600000) return "刚刚聊过";
  if (diff < 86400000) return `${Math.max(1, Math.floor(diff / 3600000))} 小时前聊过`;
  return `${Math.floor(diff / 86400000)} 天前聊过`;
}
function nextLifeThread(agent) {
  const event = (agent?.episodicMemories || []).find((item) => !["completed", "cancelled", "expired"].includes(item.status));
  return event ? `最近的生活线索：“${event.text}”。下次对话会自然接续，但不会假装知道结果。` : "还没有识别到带时间的生活事件，聊到计划或近况后会出现在这里。";
}
function updateRelationship(agent, amount = 1) {
  agent.relationship ||= { score: 12, stage: "初识", messageCount: 0, lastContactAt: 0, activeDays: [], confirmedMemoryCount: 0 };
  agent.relationship.messageCount += amount;
  const day = new Date().toISOString().slice(0, 10);
  agent.relationship.activeDays = [...new Set([...(agent.relationship.activeDays || []), day])].slice(-90);
  agent.relationship.score = Math.min(100, Math.round(8 + agent.relationship.activeDays.length * 5 + Math.min(100, agent.relationship.messageCount) * .25 + Number(agent.relationship.confirmedMemoryCount || 0) * 3));
  agent.relationship.lastContactAt = Date.now();
  agent.relationship.stage = relationshipStage(agent);
}

async function toggleProactive(event) {
  if (!state.active) return;
  state.active.proactive ||= {};
  state.active.proactive.enabled = event.target.checked;
  state.active.proactive.lastSentAt = Date.now();
  await saveAgents();
  await scheduleRollingProactiveNotifications();
}
function proactiveFrequencyText(agent) {
  const hours = Number(agent?.proactive?.intervalHours || 24);
  return hours <= 12 ? "偶尔" : hours >= 168 ? "每周" : "每天";
}
function activeLifeEvent(agent) {
  return (agent?.episodicMemories || []).find((item) => !["completed", "cancelled", "expired"].includes(item.status));
}
function previewProactive(agent) {
  const style = agent?.proactive?.style || "continue"; const event = activeLifeEvent(agent)?.text;
  if (style === "continue" && event) return `之前你说“${event.slice(0, 28)}”，后来怎么样了？`;
  if (style === "care") return ["今天是不是有点累？有空就和我说说。", "记得按时吃饭，忙完了来找我。", "今天过得还顺利吗？"][new Date().getDate() % 3];
  return ["刚刚想到你了，有空聊两句吗？", "好久没聊了，最近还好吗？", "我在呢，今天想聊点什么？"][new Date().getDate() % 3];
}
function proactivePlan(agent, at = new Date()) {
  const e = currentEmotion(agent); const event = activeLifeEvent(agent);
  const hoursSince = (at.getTime() - Number(agent?.relationship?.lastContactAt || at.getTime())) / 3600000;
  let reason = "到了你允许的联系时间"; let body = previewProactive(agent);
  if (event) { reason = "想起你最近提到的一件事"; body = `之前你说“${event.text.slice(0, 28)}”，后来怎么样了？`; }
  else if (e.concern >= 55) { reason = "上次聊天里感受到你可能有些累"; body = "刚刚有点惦记你。现在好一点了吗？"; }
  else if (hoursSince >= 72) { reason = "已经几天没有聊过了"; body = "有一阵没听到你的消息了，最近还好吗？"; }
  else if (e.energy >= 70) { reason = "想分享一点轻松的陪伴"; body = "刚好想到你了，今天有没有什么有意思的小事？"; }
  return { body, reason };
}
function inQuietHours(hour, start, end) {
  start = Number(start); end = Number(end);
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
async function saveProactiveSettings() {
  if (!state.active) return;
  state.active.proactive ||= {};
  state.active.proactive.intervalHours = Number(root.querySelector("#proactive-frequency")?.value || 24);
  state.active.proactive.quietStart = Number(root.querySelector("#quiet-start")?.value || 23);
  state.active.proactive.quietEnd = Number(root.querySelector("#quiet-end")?.value || 8);
  state.active.proactive.style = root.querySelector("#proactive-style")?.value || "continue";
  state.dirty = false; await saveAgents(); await scheduleRollingProactiveNotifications(); transitionRender(() => state.view = "profile", "back");
}

async function runProactiveCheck() {
  const now = Date.now(); const hour = new Date(now).getHours(); let changed = false;
  for (const agent of state.agents) {
    const config = agent.proactive || {};
    if (!config.enabled || inQuietHours(hour, config.quietStart ?? 23, config.quietEnd ?? 8)) continue;
    const baseline = Number(config.lastSentAt || agent.relationship?.lastContactAt || now);
    if (now - baseline < Number(config.intervalHours || 24) * 3600000) continue;
    const plan = proactivePlan(agent, new Date(now)); const content = plan.body;
    agent.turns ||= [];
    agent.turns.push({ role: "assistant", content, createdAt: now, proactive: true, proactiveReason: plan.reason });
    agent.proactive.lastSentAt = now; agent.proactiveUnread = Number(agent.proactiveUnread || 0) + 1; changed = true;
  }
  if (changed) await saveAgents();
}

function notificationId(...parts) {
  let hash = 2166136261;
  for (const char of parts.join(":")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return Math.abs(hash % 2000000000) + 1;
}
async function initializeNotifications() {
  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display === "prompt") permission = await LocalNotifications.requestPermissions();
    state.notificationsReady = permission.display === "granted";
    if (!state.notificationsReady) return;
    await LocalNotifications.createChannel({ id: "echo-messages", name: "回声消息", description: "智能体主动消息和定时提醒", importance: 4, visibility: 1, vibration: true });
    await LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => openNotificationTarget(notification));
    await LocalNotifications.addListener("localNotificationReceived", (notification) => storeNotificationMessage(notification, false));
  } catch (error) { state.notificationsReady = false; state.notificationError = error?.message || "系统通知初始化失败"; }
}
function openNotificationTarget(notification) {
  storeNotificationMessage(notification, true);
}
function storeNotificationMessage(notification, shouldOpen) {
  const agent = state.agents.find((item) => String(item.id) === String(notification?.extra?.agentId));
  if (!agent) return;
  const body = String(notification?.body || "").trim();
  agent.turns ||= [];
  if (body && !agent.turns.some((turn) => turn.notificationId === notification.id)) {
    const deliveredTurn = { role: "assistant", content: body, createdAt: Date.now(), proactive: true, proactiveReason: notification?.extra?.reason, notificationId: notification.id };
    agent.turns.push(deliveredTurn);
    agent.proactiveUnread = Number(agent.proactiveUnread || 0) + 1;
    if (!shouldOpen && state.view === "chat" && String(state.active?.id) === String(agent.id)) {
      state.turns.push(deliveredTurn); appendChatMessage(deliveredTurn, state.turns.length - 1);
    }
  }
  if (shouldOpen) openAgent(agent, true); else if (state.view === "library") render();
  void saveAgents();
}
function chineseHour(value) {
  const map = { "零":0,"一":1,"二":2,"两":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10 };
  if (/^\d{1,2}$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (map[value[1]] || 0);
  if (value.endsWith("十")) return (map[value[0]] || 0) * 10;
  if (value.includes("十")) return (map[value[0]] || 0) * 10 + (map[value.at(-1)] || 0);
  return map[value] ?? NaN;
}
function parseReminder(text, now = new Date()) {
  if (!/(提醒我|叫我|喊我|通知我|记得叫我|别忘了叫我)/.test(text)) return null;
  const relative = text.match(/(?:过)?\s*(半|[零一二两三四五六七八九十百\d]{1,4})\s*(分钟|分|个?小时)\s*后/);
  if (relative) {
    const unit = relative[2];
    const amount = relative[1] === "半" ? .5 : chineseHour(relative[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const milliseconds = /小时/.test(unit) ? amount * 3600000 : amount * 60000;
    const date = new Date(now.getTime() + milliseconds);
    const task = text.replace(/^.*?(提醒我|叫我|喊我|通知我|记得叫我|别忘了叫我)/, "").replace(relative[0], "").replace(/[，。！？,.!?]/g, "").trim();
    return { at: date, task: task || "到时间啦" };
  }
  const dayOffset = /后天/.test(text) ? 2 : /明天|明早|明晚/.test(text) ? 1 : 0;
  const match = text.match(/(?:上午|早上|早晨|中午|下午|晚上|今晚|凌晨)?\s*([零一二两三四五六七八九十百\d]{1,3})(?:点|时)(?:([0-5]?\d)分?)?/);
  if (!match) return null;
  let hour = chineseHour(match[1]); let minute = Number(match[2] || 0);
  if (!Number.isFinite(hour) || hour > 23) return null;
  if (/(下午|晚上|今晚)/.test(match[0]) && hour < 12) hour += 12;
  if (/中午/.test(match[0]) && hour < 11) hour += 12;
  if (/凌晨/.test(match[0]) && hour === 12) hour = 0;
  const date = new Date(now); date.setSeconds(0, 0); date.setDate(date.getDate() + dayOffset); date.setHours(hour, minute, 0, 0);
  if (dayOffset === 0 && date <= now) date.setDate(date.getDate() + 1);
  const task = text.replace(/^.*?(提醒我|叫我|喊我|通知我|记得叫我|别忘了叫我)/, "").replace(match[0], "").replace(/[，。！？,.!?]/g, "").trim();
  return { at: date, task: task || "到时间啦" };
}
function formatReminderTime(value) {
  const date = new Date(value); return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
async function scheduleReminderFromMessage(text, agent, turn) {
  const reminder = parseReminder(text); if (!reminder) return null;
  if (!state.notificationsReady) await initializeNotifications();
  const id = notificationId("reminder", agent.id, reminder.at.getTime(), reminder.task);
  agent.reminders ||= [];
  const record = { id, at: reminder.at.getTime(), task: reminder.task, createdAt: Date.now(), scheduled: false };
  agent.reminders.push(record);
  turn.reminderAt = reminder.at.getTime();
  turn.reminderStatus = "pending";
  if (state.notificationsReady) {
    try {
      const exact = await LocalNotifications.checkExactNotificationSetting().catch(() => ({ exact_alarm: "granted" }));
      if (exact.exact_alarm !== "granted") {
        await LocalNotifications.changeExactNotificationSetting();
        throw new Error("请允许精确闹钟权限后重新设置提醒");
      }
      await LocalNotifications.schedule({ notifications: [{ id, title: agent.name, body: reminder.task === "到时间啦" ? `${agent.name}：到时间啦。` : `${agent.name}：该${reminder.task}了。`, channelId: "echo-messages", schedule: { at: reminder.at, allowWhileIdle: true }, extra: { agentId: String(agent.id), type: "reminder" } }] });
      record.scheduled = true; turn.reminderStatus = "scheduled";
      showToast(`提醒已设为 ${formatReminderTime(reminder.at)}`, "success");
    } catch (error) {
      record.scheduleError = error?.message || "系统没有接受这条提醒";
      turn.reminderStatus = "failed";
      showToast(record.scheduleError, "error");
    }
  } else {
    record.scheduleError = state.notificationError || "请在系统设置中允许回声发送通知";
    turn.reminderStatus = "failed";
    showToast(record.scheduleError, "error");
  }
  await saveAgents();
  return { ...reminder, scheduled: record.scheduled };
}
async function materializeDueReminders() {
  const now = Date.now(); let changed = false;
  for (const agent of state.agents) {
    agent.turns ||= [];
    for (const reminder of (agent.reminders || [])) {
      if (Number(reminder.at) > now || reminder.materializedAt) continue;
      const body = reminder.task === "到时间啦" ? `${agent.name}：到时间啦。` : `${agent.name}：该${reminder.task}了。`;
      if (!agent.turns.some((turn) => Number(turn.notificationId) === Number(reminder.id))) {
        agent.turns.push({ role: "assistant", content: body, createdAt: Number(reminder.at) || now, proactive: true, notificationId: reminder.id });
        agent.proactiveUnread = Number(agent.proactiveUnread || 0) + 1;
      }
      reminder.materializedAt = now; changed = true;
    }
  }
  if (changed) await saveAgents();
  return changed;
}

function syncMaterializedMessages() {
  if (state.view === "chat" && state.active) {
    const latest = (state.active.turns || []).map((turn) => ({ ...turn }));
    const previousLength = state.turns.length;
    state.turns = latest;
    if (latest.length >= previousLength) {
      latest.slice(previousLength).forEach((turn, offset) => appendChatMessage(turn, previousLength + offset));
      return;
    }
  }
  if (["home", "library", "profile", "proactive"].includes(state.view)) render();
}
async function rescheduleSavedReminders() {
  if (!state.notificationsReady) return;
  const notifications = [];
  for (const agent of state.agents) for (const reminder of (agent.reminders || []).filter((item) => Number(item.at) > Date.now())) {
    notifications.push({ id: Number(reminder.id), title: agent.name, body: reminder.task === "到时间啦" ? `${agent.name}：到时间啦。` : `${agent.name}：该${reminder.task}了。`, channelId: "echo-messages", schedule: { at: new Date(reminder.at), allowWhileIdle: true }, extra: { agentId: String(agent.id), type: "reminder" } });
  }
  if (notifications.length) {
    try {
      await LocalNotifications.schedule({ notifications });
      for (const agent of state.agents) for (const reminder of (agent.reminders || [])) if (Number(reminder.at) > Date.now()) reminder.scheduled = true;
      await saveAgents();
    } catch (error) { recordBackgroundIssue("恢复定时提醒失败", error); }
  }
}
async function scheduleRollingProactiveNotifications() {
  if (!state.notificationsReady) return;
  const slotCount = 14;
  const obsolete = state.agents.flatMap((agent) => Array.from({ length: slotCount }, (_, index) => ({ id: notificationId("proactive", agent.id, index + 1) })));
  if (obsolete.length) { try { await LocalNotifications.cancel({ notifications: obsolete }); } catch (error) { recordBackgroundIssue("更新主动消息计划失败", error); } }
  const notifications = [];
  for (const agent of state.agents.filter((item) => item.proactive?.enabled)) {
    const hours = Math.max(8, Number(agent.proactive.intervalHours || 24));
    const emotion = currentEmotion(agent);
    const timingFactor = emotion.concern >= 55 ? .72 : emotion.energy <= 30 ? 1.35 : emotion.closeness >= 65 ? .9 : 1;
    for (let slot = 1; slot <= slotCount; slot++) {
      const naturalHours = Math.max(8, hours * timingFactor);
      const jitterMinutes = (notificationId(agent.id, slot) % Math.max(61, Math.round(naturalHours * 24))) - Math.round(naturalHours * 12);
      const at = new Date(Date.now() + naturalHours * slot * 3600000 + jitterMinutes * 60000);
      const start = Number(agent.proactive.quietStart ?? 23), end = Number(agent.proactive.quietEnd ?? 8);
      if (inQuietHours(at.getHours(), start, end)) { at.setDate(at.getDate() + (start > end ? 1 : 0)); at.setHours(end, 8 + notificationId(agent.id, slot) % 37, 0, 0); }
      const plan = proactivePlan(agent, at);
      notifications.push({ id: notificationId("proactive", agent.id, slot), title: agent.name, body: plan.body, channelId: "echo-messages", schedule: { at, allowWhileIdle: true }, extra: { agentId: String(agent.id), type: "proactive", reason: plan.reason } });
    }
  }
  if (notifications.length) {
    try { await LocalNotifications.schedule({ notifications }); state.proactiveScheduledAt = Date.now(); state.backgroundIssue = ""; }
    catch (error) { recordBackgroundIssue("主动消息安排失败", error); }
  } else state.proactiveScheduledAt = Date.now();
}

function groupMembers(group) {
  return (group?.memberIds || []).map((id) => state.agents.find((agent) => String(agent.id) === String(id))).filter(Boolean);
}
async function createGroup() {
  const memberIds = [...root.querySelectorAll(".group-members input:checked")].map((input) => input.value);
  if (memberIds.length < 2) return;
  const name = root.querySelector("#group-name")?.value.trim() || groupMembers({ memberIds }).map((a) => a.name).join("、");
  if (state.groupEditing && state.activeGroup) {
    state.activeGroup.name = name; state.activeGroup.memberIds = memberIds; state.groupEditing = false; state.groupSeedId = null;
    await saveGroups(); openGroup(state.activeGroup); return;
  }
  const group = { id: `g-${Date.now()}`, name, memberIds, turns: [], createdAt: Date.now() };
  state.groups.unshift(group); state.groupSeedId = null; await saveGroups(); openGroup(group);
}
async function deleteGroup() {
  if (!state.activeGroup || !window.confirm("确定删除这个群聊吗？单聊和智能体不会受影响。")) return;
  state.groups = state.groups.filter((group) => group !== state.activeGroup); state.activeGroup = null; state.groupEditing = false;
  await saveGroups(); transitionRender(() => state.view = "library", "back");
}
function openGroup(group) {
  state.groupAutoRunning = false; state.groupAutoToken++; state.groupAutoStatus = "";
  state.activeGroup = group; state.groupTurns = group.turns || []; state.groupWindowStart = Math.max(0, state.groupTurns.length - CHAT_WINDOW_SIZE); state.busy = false; state.error = ""; state.view = "groupChat"; render();
}
async function sendGroupMessage(event) {
  event.preventDefault();
  const input = root.querySelector("#group-message"); const content = input?.value.trim();
  const pendingImage = state.pendingGroupImage;
  if ((!content && !pendingImage) || state.busy) return;
  const userTurn = { role: "user", content: content || "分享了一张图片", imageData: pendingImage?.data, imageMime: pendingImage?.mime, createdAt: Date.now() };
  state.groupTurns.push(userTurn); input.value = ""; state.pendingGroupImage = null; state.busy = true;
  appendGroupMessageNode(userTurn); setGroupBusyUI(true);
  try {
    const members = groupMembers(state.activeGroup);
    const mentioned = members.find((agent) => content.includes(`@${agent.name}`) || content.includes(agent.name));
    const asksEveryone = /(大家|你们|都说说|每个人|一起聊|怎么看)/.test(content);
    const ranked = [...members].sort((a, b) => Number(b.relationship?.lastContactAt || 0) - Number(a.relationship?.lastContactAt || 0));
    const speakers = mentioned ? [mentioned] : ranked.slice(0, asksEveryone ? Math.min(2, ranked.length) : 1);
    for (let speakerIndex = 0; speakerIndex < speakers.length; speakerIndex++) {
      const agent = speakers[speakerIndex];
      await new Promise((resolve) => setTimeout(resolve, speakerIndex ? 1300 + Math.random() * 1700 : 550 + Math.random() * 900));
      setGroupBusyUI(true, `${agent.name} 正在输入…`);
      const history = state.groupTurns.slice(-16).map((turn) => `${turn.role === "user" ? "用户" : turn.agent?.name || "成员"}：${turn.content}`).join("\n");
      const prompt = `你正在一个真实节奏的多人聊天中扮演“${agent.name}”，关系是${agent.relation || "重要的人"}。严格学习参考记录里的语气，但不得冒充真人。群成员有：${members.map((a) => a.name).join("、")}。自然接住具体内容，可以赞同、打趣、补充或轻微不同意；不要轮流发表演讲，不重复上一位，不必总提问。只发一条5至45字的消息；确实没必要说话就只输出PASS。${pendingImage ? "用户刚分享了一张生活照片，请先看图再自然回应。" : ""}\n参考记录：\n${String(agent.log || "").slice(0, 3500)}\n群聊：\n${history}`;
      const promptContent = pendingImage ? [{ type: "input_text", text: prompt }, { type: "input_image", image_url: pendingImage.data }] : prompt;
      const reply = cleanReply(await requestArk({ messages: [{ role: "user", content: promptContent }], maxOutputTokens: 100 }));
      const routingReason = mentioned ? "被点名" : asksEveryone ? "接力回应" : "最相关";
      if (reply && !/^PASS$/i.test(reply)) {
        const previousSpeaker = state.groupTurns.at(-1)?.agent?.name || "你";
        const assistantTurn = { role: "assistant", content: reply, agentId: agent.id, agent, routingReason, replyTo: previousSpeaker, createdAt: Date.now() };
        state.groupTurns.push(assistantTurn); appendGroupMessageNode(assistantTurn);
        if (speakers.length > 1) setGroupBusyUI(true, "另一位正在接话");
      }
      updateRelationship(agent, 1);
    }
  } catch (error) {
    state.error = error?.message || "群聊回应失败";
    root.querySelector(".group-msgs")?.insertAdjacentHTML("beforeend", `<div class="error is-entering">${esc(state.error)}</div>`);
  }
  state.busy = false; state.activeGroup.turns = state.groupTurns.map((turn) => ({ role: turn.role, content: turn.content, imageData: turn.imageData, imageMime: turn.imageMime, agentId: turn.agentId, agent: turn.agent ? { id: turn.agent.id, name: turn.agent.name, avatar: turn.agent.avatar } : undefined, routingReason: turn.routingReason, replyTo: turn.replyTo, createdAt: turn.createdAt }));
  setGroupBusyUI(false); await Promise.all([saveGroups(), saveAgents()]);
}
function syncGroupAutoUI() {
  const button = root.querySelector("[data-group-auto]"); const status = root.querySelector("[data-group-auto-status]");
  if (button) { button.classList.toggle("active", state.groupAutoRunning); button.querySelector("span").textContent = state.groupAutoRunning ? "停止自由聊天" : "让他们聊聊"; }
  if (status) status.textContent = state.groupAutoStatus || "他们会慢慢接话，也可能暂时沉默";
}
function appendGroupTurn(turn) {
  state.groupTurns.push(turn);
  appendGroupMessageNode(turn);
}
function waitForGroupTurn(milliseconds, token) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (!state.groupAutoRunning || token !== state.groupAutoToken) return resolve(false);
      const left = Math.max(0, Math.ceil((milliseconds - (Date.now() - started)) / 1000));
      state.groupAutoStatus = left ? `${left} 秒后可能有人接话` : "正在想要不要接话"; syncGroupAutoUI();
      if (Date.now() - started >= milliseconds) resolve(true); else setTimeout(tick, Math.min(1000, milliseconds));
    }; tick();
  });
}
async function startAutonomousGroupChat() {
  const group = state.activeGroup; const members = groupMembers(group);
  if (!group || members.length < 2 || state.groupAutoRunning) return;
  state.groupAutoRunning = true; state.groupAutoToken++; const token = state.groupAutoToken;
  const turnLimit = 2 + notificationId(group.id, Date.now()) % 4;
  state.groupAutoStatus = "他们正在看看群里的话题"; syncGroupAutoUI();
  let previousAgentId = state.groupTurns.at(-1)?.agentId;
  for (let index = 0; index < turnLimit && state.groupAutoRunning && token === state.groupAutoToken; index++) {
    const delay = index === 0 ? 3000 + Math.random() * 4500 : 7000 + Math.random() * 9000;
    if (!(await waitForGroupTurn(delay, token))) break;
    if (index > 0 && Math.random() < .35) { state.groupAutoStatus = "群里安静了一会儿"; syncGroupAutoUI(); continue; }
    const choices = members.filter((agent) => String(agent.id) !== String(previousAgentId));
    const agent = choices[Math.floor(Math.random() * choices.length)] || members[0];
    state.groupAutoStatus = `${agent.name} 正在输入…`; syncGroupAutoUI();
    try {
      const history = state.groupTurns.slice(-18).map((turn) => `${turn.role === "user" ? "用户" : turn.agent?.name || "成员"}：${turn.content}`).join("\n") || "群聊刚刚建立，还没有人说话。";
      const prompt = `你在一个真实节奏的多人群聊里扮演“${agent.name}”，关系是${agent.relation || "重要的人"}。群成员：${members.map((item) => item.name).join("、")}。根据最近内容自然接一句；可以开启一个轻松的生活话题，但不能凭空捏造共同经历。不要总提问，不要复述上一句，不要说自己是AI。只发一条5至35字的消息。如果此刻不适合接话，只输出PASS。\n表达参考：\n${String(agent.log || "").slice(0, 2800)}\n群聊：\n${history}`;
      const reply = cleanReply(await requestArk({ messages: [{ role: "user", content: prompt }], maxOutputTokens: 70 }));
      if (reply && !/^PASS$/i.test(reply)) { appendGroupTurn({ role: "assistant", content: reply, agentId: agent.id, agent, routingReason: "自由聊天", replyTo: state.groupTurns.at(-1)?.agent?.name || "你", createdAt: Date.now() }); previousAgentId = agent.id; updateRelationship(agent, 1); }
    } catch (error) { state.groupAutoStatus = "网络有点慢，大家先安静一下"; recordBackgroundIssue("群聊自由对话失败", error); syncGroupAutoUI(); }
  }
  if (token !== state.groupAutoToken) return;
  state.groupAutoRunning = false; state.groupAutoStatus = "这轮聊天自然停下来了"; syncGroupAutoUI();
  if (state.activeGroup) state.activeGroup.turns = state.groupTurns.map((turn) => ({ role: turn.role, content: turn.content, imageData: turn.imageData, imageMime: turn.imageMime, agentId: turn.agentId, agent: turn.agent ? { id: turn.agent.id, name: turn.agent.name, avatar: turn.agent.avatar } : undefined, routingReason: turn.routingReason, replyTo: turn.replyTo, createdAt: turn.createdAt }));
  await Promise.all([saveGroups(), saveAgents()]);
}
function stopAutonomousGroupChat() {
  state.groupAutoRunning = false; state.groupAutoToken++; state.groupAutoStatus = "已停止自由聊天"; syncGroupAutoUI();
  if (state.activeGroup) { state.activeGroup.turns = state.groupTurns.map((turn) => ({ role: turn.role, content: turn.content, imageData: turn.imageData, imageMime: turn.imageMime, agentId: turn.agentId, agent: turn.agent ? { id: turn.agent.id, name: turn.agent.name, avatar: turn.agent.avatar } : undefined, routingReason: turn.routingReason, replyTo: turn.replyTo, createdAt: turn.createdAt })); void saveGroups(); }
}

function incrementalLines(value) {
  const old = new Set(String(state.active?.log || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !old.has(line));
}
function updateIncrementalPreview(event) {
  const raw = String(event.target.value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lines = incrementalLines(event.target.value); const duplicates = Math.max(0, raw.length - lines.length);
  const speakers = new Set(lines.map((line) => line.match(/^([^：:]{1,20})[：:]/)?.[1]).filter(Boolean));
  const valid = lines.filter((line) => line.length >= 4 && /[：:]/.test(line));
  const set = (selector, value) => { const node = root.querySelector(selector); if (node) node.textContent = value; };
  set("[data-new-count]", `${lines.length} 条`); set("[data-duplicate-count]", `${duplicates} 条`); set("[data-speaker-count]", `${speakers.size} 人`); set("[data-sample-count]", `${valid.length} 条`);
  const button = root.querySelector("[data-apply-incremental]");
  if (button) button.disabled = lines.length < 2;
}
async function applyIncrementalLearning() {
  const additions = incrementalLines(root.querySelector("#incremental-log")?.value);
  if (additions.length < 2 || !state.active) return;
  state.active.trainingVersions ||= [];
  state.active.trainingVersions.unshift({ id: String(Date.now()), log: state.active.log, createdAt: Date.now(), chars: String(state.active.log || "").length });
  state.active.trainingVersions = state.active.trainingVersions.slice(0, 5);
  state.active.log = `${String(state.active.log || "").trim()}\n${additions.join("\n")}`.trim();
  state.active.lastIncrementalAt = Date.now();
  await saveAgents();
  state.dirty = false; await saveAgents(); transitionRender(() => state.view = "profile", "back");
}
async function rollbackTrainingVersion(versionId) {
  const versions = state.active?.trainingVersions || [];
  const index = versionId ? versions.findIndex((item) => String(item.id) === String(versionId)) : 0;
  const version = versions[index];
  if (!version) return;
  if (!window.confirm(`恢复到 ${new Date(version.createdAt).toLocaleString("zh-CN")} 的素材版本？当前素材会自动保留为一个版本。`)) return;
  const current = { id: String(Date.now()), log: state.active.log, createdAt: Date.now(), chars: String(state.active.log || "").length };
  state.active.trainingVersions.splice(index, 1); state.active.trainingVersions.unshift(current);
  state.active.log = version.log; state.active.trainingStatus = "ready";
  await saveAgents(); transitionRender(() => state.view = "profile", "back");
}
async function deleteAgent() {
  if (state.deleteIndex === null) return;
  const removed = state.agents[state.deleteIndex];
  state.agents.splice(state.deleteIndex, 1);
  state.groups = state.groups.map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => String(id) !== String(removed?.id)) })).filter((group) => group.memberIds.length >= 2);
  state.deleteIndex = null; state.view = "library"; await Promise.all([saveAgents(), saveGroups()]); render();
}
async function uploadVoice(e) {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const data = await fileToBase64(file);
    await uploadVoicePayload(data, file.type || "audio/mpeg", file.name);
  } catch (err) { state.draft.voiceStatus = err.message || "上传失败，请确认电脑服务已启动"; }
  render();
}
async function uploadVoicePayload(audio, mime, name) {
  state.draft.voiceStatus = "正在安全上传到云端并创建音色…"; render();
  const r = await CapacitorHttp.post({ url: `${state.settings.computer.replace(/\/$/, "")}/voice/reference`, headers: bridgeHeaders(), data: { voiceId: state.draft.voiceId, mime, name, audio } });
  if (r.status !== 200) throw new Error(r.data?.detail || "上传失败");
  const result = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  state.draft.voiceId = result?.voiceId || state.draft.voiceId;
  state.draft.voiceProvider = result?.provider || "local";
  state.draft.voiceReady = true;
  state.draft.voiceStatus = state.draft.voiceProvider === "aliyun" ? "云端音色已创建，不占用电脑显卡" : "音色样本处理完成";
  state.draft.recordedAudio = "";
  state.draft.recordedDuration = 0;
  state.draft.recordedMime = "";
  state.draft.recordedName = "";
}
async function toggleVoiceSampleRecording() {
  if (state.draft.voiceRecording) { await stopVoiceSampleRecording(); return; }
  try {
    await EchoSpeech.startVoiceSampleRecording();
    state.draft.voiceRecording = true;
    state.draft.voiceReady = false;
    state.draft.voiceStatus = "正在录音，请自然地连续说话";
    const section = root.querySelector(".voice-capture");
    const button = root.querySelector("[data-record-voice]");
    section?.classList.add("recording");
    button?.classList.add("recording");
    if (button?.querySelector("b")) button.querySelector("b").textContent = "停止录音";
    const statusText = root.querySelector(".voice-status");
    if (statusText) statusText.textContent = state.draft.voiceStatus;
    clearInterval(voiceSampleTimer);
    voiceSampleTimer = setInterval(updateVoiceSampleMeter, 160);
  } catch (error) {
    state.draft.voiceRecording = false;
    state.draft.voiceStatus = error?.message || "无法开始录音，请检查麦克风权限";
    render();
  }
}
async function updateVoiceSampleMeter() {
  if (!state.draft.voiceRecording) return;
  try {
    const status = await EchoSpeech.voiceSampleRecordingStatus();
    const elapsed = Math.min(30000, Number(status?.duration || 0));
    const seconds = Math.floor(elapsed / 1000);
    const time = root.querySelector(".voice-record-button time");
    if (time) time.textContent = `00:${String(seconds).padStart(2, "0")}`;
    const level = Math.min(1, Math.max(.08, Number(status?.amplitude || 0) / 22000));
    root.querySelector(".record-wave")?.style.setProperty("--voice-level", level.toFixed(2));
    if (elapsed >= 30000) await stopVoiceSampleRecording();
  } catch {}
}
async function stopVoiceSampleRecording() {
  clearInterval(voiceSampleTimer); voiceSampleTimer = null;
  if (!state.draft.voiceRecording) return;
  state.draft.voiceRecording = false;
  try {
    const result = await EchoSpeech.stopVoiceSampleRecording();
    const duration = Number(result?.duration || 0);
    if (duration < 10000) {
      state.draft.voiceStatus = `只录了 ${Math.max(1, Math.round(duration / 1000))} 秒，请至少录制 10 秒`;
    } else {
      state.draft.recordedAudio = String(result?.audio || "");
      state.draft.recordedMime = result?.mime || "audio/mp4";
      state.draft.recordedName = result?.name || `voice-${Date.now()}.m4a`;
      state.draft.recordedDuration = duration;
      state.draft.voiceStatus = "录音完成，请试听后确认";
    }
  } catch (error) {
    state.draft.voiceStatus = error?.message || "录音保存失败，请重试";
  }
  render();
}
async function confirmRecordedVoice() {
  if (!state.draft.recordedAudio) return;
  try {
    await uploadVoicePayload(state.draft.recordedAudio, state.draft.recordedMime || "audio/mp4", state.draft.recordedName || `voice-${Date.now()}.m4a`);
  } catch (error) {
    state.draft.voiceStatus = error?.message || "上传失败，请确认电脑服务已启动";
  }
  render();
}
async function uploadAgentAvatar(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  try {
    const avatar = await compressAvatar(file);
    if (state.view === "wizard") state.draft.avatar = avatar;
    else if (state.active) { state.active.avatar = avatar; await saveAgents(); }
    render();
  } catch { state.error = "头像处理失败，请换一张图片"; render(); }
}
function compressAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 384; const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext("2d");
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const x = (image.naturalWidth - side) / 2; const y = (image.naturalHeight - side) / 2;
      context.drawImage(image, x, y, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", .84));
      URL.revokeObjectURL(image.src);
    };
    image.onerror = reject; image.src = URL.createObjectURL(file);
  });
}
async function selectChatImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return showToast("请选择 JPG、PNG 或 WebP 图片", "error");
  try {
    state.pendingImage = { data: await compressChatImage(file), name: file.name, mime: "image/jpeg" };
    render();
  } catch (error) { recordBackgroundIssue("图片处理失败", error, true); }
}
async function selectGroupImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return showToast("请选择 JPG、PNG 或 WebP 图片", "error");
  try { state.pendingGroupImage = { data: await compressChatImage(file), name: file.name, mime: "image/jpeg" }; render(); }
  catch (error) { recordBackgroundIssue("群聊图片处理失败", error, true); }
}
function compressChatImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image(); const url = URL.createObjectURL(file);
    image.onload = () => {
      const maxSide = 1280; const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL("image/jpeg", .78));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取这张图片")); };
    image.src = url;
  });
}
function fileToBase64(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(file); }); }
function openAgent(a, animated = false) {
  const update = () => {
    state.active = a;
    a.proactiveUnread = 0;
    void saveAgents();
    state.turns = (a.turns?.length ? a.turns : [{ role: "assistant", content: `嗨，我是${a.name}。想聊点什么？`, createdAt: Date.now() }]).map((turn, index) => ({ role: turn.role, content: turn.content, createdAt: turn.createdAt || Number(a.createdAt) || Date.now() + index, timestampEstimated: Boolean(turn.timestampEstimated || !turn.createdAt), inputType: turn.inputType, imageData: turn.imageData, imageMime: turn.imageMime, photoMemorySaved: turn.photoMemorySaved, proactive: turn.proactive, proactiveReason: turn.proactiveReason, reminderAt: turn.reminderAt, reminderStatus: turn.reminderStatus, notificationId: turn.notificationId }));
    state.chatWindowStart = Math.max(0, state.turns.length - CHAT_WINDOW_SIZE);
    state.error = ""; state.phase = ""; state.fallbackNotice = ""; state.pendingImage = null; state.busy = false; state.view = "chat";
  };
  if (animated) transitionRender(update); else { update(); render(); }
}
async function send(e) {
  e.preventDefault();
  if (state.busy) return;
  unlockVoiceAudio();
  const input = root.querySelector("#message"); const content = input.value.trim(); const image = state.pendingImage;
  if (!content && !image) return;
  const turn = { role: "user", content, createdAt: Date.now(), imageData: image?.data, imageMime: image?.mime };
  if (content) updateEmotion(state.active, content, "user");
  state.pendingImage = null; state.turns.push(turn); input.value = ""; input.style.height = "auto"; root.querySelector(".pending-image")?.remove(); root.querySelector("#send")?.classList.remove("has-text"); appendChatMessage(turn, state.turns.length - 1);
  const reminder = content ? await scheduleReminderFromMessage(content, state.active, turn) : null;
  if (reminder) refreshMessageMarkup(state.turns.length - 1);
  if (content) await rememberFromMessage(content);
  state.active.turns = state.turns; await saveAgents();
  await generateReply();
}
async function submitVoiceMessage(content) {
  if (!content?.trim() || state.busy || !state.active) return;
  const turn = { role: "user", content: content.trim(), createdAt: Date.now(), inputType: "voice" };
  updateEmotion(state.active, turn.content, "user");
  state.turns.push(turn); appendChatMessage(turn, state.turns.length - 1);
  const reminder = await scheduleReminderFromMessage(turn.content, state.active, turn);
  if (reminder) refreshMessageMarkup(state.turns.length - 1);
  await rememberFromMessage(turn.content);
  state.active.turns = state.turns; await saveAgents();
  await generateReply();
}
function refreshMessageMarkup(index) {
  const wrapper = root.querySelector(`[data-message-index="${index}"]`)?.closest(".message-wrap");
  if (wrapper && state.turns[index]) { wrapper.outerHTML = messageMarkup(state.turns[index], index, false); bindMessageInteractions(); }
}
function normalizeSpeechText(value) {
  return String(value || "")
    .replace(/deep\s*(?:siak|seek|seak|sink)/ig, "DeepSeek")
    .replace(/(?:ch|chat)\s*gpt/ig, "ChatGPT")
    .replace(/we\s*clone/ig, "WeClone")
    .replace(/spark\s*[- ]?tts/ig, "Spark-TTS")
    .replace(/\bai\b/ig, "AI")
    .trim();
}
function speechContextWords() {
  const words = [state.active?.name, state.active?.relation];
  for (const memory of (state.active?.memories || []).slice(0, 8)) {
    words.push(...String(memory.text || "").match(/[\u4e00-\u9fa5A-Za-z0-9]{2,8}/g) || []);
  }
  for (const turn of state.turns.slice(-8)) {
    words.push(...String(turn.content || "").match(/[\u4e00-\u9fa5A-Za-z0-9]{2,8}/g) || []);
  }
  return [...new Set(words.filter(Boolean))].slice(0, 40);
}
async function listenForVoiceMessage() {
  if (state.busy || state.voiceListening || !state.active) return;
  state.voiceListening = true;
  const sheet = root.querySelector(".recording-sheet");
  const button = root.querySelector("[data-hold-talk]");
  if (sheet) sheet.hidden = false;
  button?.classList.add("listening");
  let partialListener = null;
  let previewTimer = 0;
  let pendingPreview = "";
  try {
    const status = await EchoSpeech.recognitionStatus().catch(() => null);
    const title = sheet?.querySelector("b"); const hint = sheet?.querySelector("span");
    if (status?.loading) {
      if (title) title.textContent = "正在准备本地识别";
      if (hint) hint.textContent = "首次使用只需准备一次";
    } else if (status?.ready && hint) {
      hint.textContent = "离线识别 · 松开发送";
    }
    partialListener = await EchoSpeech.addListener("partialResult", ({ text }) => {
      if (!text) return;
      pendingPreview = normalizeSpeechText(text);
      if (previewTimer) return;
      previewTimer = window.setTimeout(() => {
        previewTimer = 0;
        const preview = sheet?.querySelector("output");
        if (preview && pendingPreview) preview.textContent = pendingPreview.slice(-36);
      }, 180);
    }).catch(() => null);
    const result = await EchoSpeech.listen({ language: "zh-CN", contextWords: speechContextWords() });
    const text = normalizeSpeechText(result?.text);
    if (text && state.voiceListening) await submitVoiceMessage(text);
  } catch (error) {
    if (state.voiceListening && error?.message !== "cancelled") {
      state.error = error?.message || "没有听清，请再说一次";
      syncChatGeneration();
    }
  } finally {
    if (previewTimer) clearTimeout(previewTimer);
    try { await partialListener?.remove(); } catch {}
    state.voiceListening = false;
    if (sheet) sheet.hidden = true;
    button?.classList.remove("listening");
  }
}
function bindHoldToTalk(button) {
  if (!button) return;
  let startY = 0; let pointerId = null; let cancelling = false;
  const sheet = root.querySelector(".recording-sheet");
  const title = sheet?.querySelector("b"); const hint = sheet?.querySelector("span"); const preview = sheet?.querySelector("output");
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("pointerdown", (event) => {
    if (state.busy || state.voiceListening) return;
    event.preventDefault(); pointerId = event.pointerId; startY = event.clientY; cancelling = false;
    button.setPointerCapture?.(pointerId); button.classList.add("pressed");
    if (title) title.textContent = "正在说话";
    if (hint) hint.textContent = "上滑取消 · 松开发送";
    if (preview) preview.textContent = "等待你开口…";
    listenForVoiceMessage();
  });
  button.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId || !state.voiceListening) return;
    cancelling = startY - event.clientY > 72;
    button.classList.toggle("cancel-ready", cancelling); sheet?.classList.toggle("cancel-ready", cancelling);
    if (title) title.textContent = cancelling ? "松开取消" : "正在说话";
    if (hint) hint.textContent = cancelling ? "移回下方继续" : "上滑取消 · 松开发送";
  });
  const release = async (event) => {
    if (pointerId !== event.pointerId) return;
    button.releasePointerCapture?.(pointerId); pointerId = null; button.classList.remove("pressed", "cancel-ready"); sheet?.classList.remove("cancel-ready");
    if (!state.voiceListening) return;
    if (cancelling) await cancelVoiceInput();
    else { if (title) title.textContent = "正在识别"; if (hint) hint.textContent = "马上就好"; try { await EchoSpeech.finishListening(); } catch {} }
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", async (event) => { if (pointerId === event.pointerId) { pointerId = null; await cancelVoiceInput(); } });
}
async function cancelVoiceInput() {
  state.voiceListening = false;
  try { await EchoSpeech.stop(); } catch {}
  const sheet = root.querySelector(".recording-sheet");
  if (sheet) sheet.hidden = true;
  root.querySelector("[data-hold-talk]")?.classList.remove("listening");
}
function showCallConfirmation() {
  if (state.callActive || root.querySelector(".call-dialog-backdrop")) return;
  const online = state.connection === "online";
  root.querySelector(".wechat-chat")?.insertAdjacentHTML("beforeend", `<div class="call-dialog-backdrop"><section class="call-dialog"><i class="call-dialog-avatar" style="${avatarStyle(state.active)}">${avatarText(state.active)}</i><small>VOICE CALL</small><h3>呼叫 ${esc(state.active?.name)}</h3><p>${online ? "服务器在线，语音已准备好。" : "服务器暂时离线；快速档仍可尝试系统语音。"}</p><div><button data-close-call-dialog>取消</button><button class="primary" data-confirm-call>开始通话</button></div></section></div>`);
  root.querySelector("[data-close-call-dialog]")?.addEventListener("click", () => root.querySelector(".call-dialog-backdrop")?.remove());
  root.querySelector("[data-confirm-call]")?.addEventListener("click", () => { root.querySelector(".call-dialog-backdrop")?.remove(); startCall(); });
}
async function startCall() {
  if (state.callActive) return;
  unlockVoiceAudio();
  state.callMuted = false; state.callSpeaker = true; state.callCaption = ""; state.callReconnects = 0;
  state.callStartedAt = Date.now();
  state.callActive = true; state.callPhase = `正在呼叫 ${state.active.name}`;
  void prewarmCallVoice();
  try { await EchoSpeech.setAudioRoute({ speaker: true }); } catch {}
  root.querySelector(".wechat-chat")?.insertAdjacentHTML("beforeend", callMarkup());
  bindCallControls();
  clearInterval(state.callTimer);
  state.callTimer = setInterval(syncCallUI, 1000);
  setTimeout(() => callListen(), 220);
}
async function prewarmCallVoice() {
  if (!state.active?.voiceReady) return;
  try { await CapacitorHttp.post({ url: `${state.settings.computer.replace(/\/$/, "")}/voice/warm`, headers: bridgeHeaders(), data: { voiceId: state.active.voiceId }, connectTimeout: 3000, readTimeout: 30000 }); }
  catch (error) { recordBackgroundIssue("通话声音预热失败", error); }
}
async function callListen() {
  if (!state.callActive || state.callMuted) return;
  state.callPhase = "正在聆听…"; syncCallUI();
  try {
    const result = await EchoSpeech.listen({ language: "zh-CN", contextWords: speechContextWords(), autoFinish: true });
    if (!state.callActive) return;
    const text = normalizeSpeechText(result?.text);
    if (!text) throw new Error("没有听清");
    state.callReconnects = 0;
    state.callCaption = `你：${text}`;
    state.callPhase = "正在理解你说的话"; syncCallUI();
    await submitVoiceMessage(text);
  } catch (error) {
    if (!state.callActive) return;
    state.callReconnects = Number(state.callReconnects || 0) + 1;
    state.callPhase = error?.message === "cancelled" ? "通话已暂停" : state.callReconnects > 2 ? "连接不稳定，正在恢复" : "没有听清，正在重新聆听";
    syncCallUI();
    setTimeout(() => callListen(), 900);
  }
}
async function endCall() {
  const callStartedAt = state.callStartedAt;
  const callTurns = state.turns.filter((turn) => Number(turn.createdAt || 0) >= callStartedAt);
  state.callActive = false; state.callPhase = "";
  state.generationId++;
  clearInterval(generationPhaseTimer);
  state.busy = false; state.phase = "";
  const unfinished = state.turns.at(-1);
  if (unfinished?.streaming) {
    unfinished.streaming = false;
    if (!unfinished.content.trim()) state.turns.pop();
  }
  clearInterval(state.callTimer); state.callTimer = null; state.callStartedAt = 0;
  try { await EchoSpeech.stop(); } catch {}
  try { await EchoSpeech.stopSpeaking(); } catch {}
  try { await EchoSpeech.resetAudioRoute(); } catch {}
  stopVoice();
  syncChatGeneration();
  const screen = root.querySelector(".wechat-call");
  if (screen) { screen.classList.add("leaving"); setTimeout(() => screen.remove(), 220); }
  if (state.active && callTurns.length >= 2) showCallSummary(callTurns);
}
function showCallSummary(turns) {
  const topic = turns.map((turn) => turn.content).join("；").slice(0, 150);
  root.querySelector(".wechat-chat")?.insertAdjacentHTML("beforeend", `<div class="call-dialog-backdrop"><section class="call-dialog call-summary"><small>CALL ENDED</small><h3>通话结束</h3><p>${esc(topic)}</p><div class="summary-actions"><button data-call-summary="discard">不保存</button><button data-call-summary="record">仅留记录</button><button class="primary" data-call-summary="memory">存入记忆</button></div></section></div>`);
  root.querySelectorAll("[data-call-summary]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.callSummary;
    if (action === "memory") {
      state.active.episodicMemories ||= [];
      state.active.episodicMemories.unshift({ id: `call-${Date.now()}`, text: `通话摘要：${topic}`, createdAt: Date.now(), automatic: false, source: "call", status: "completed" });
      await saveAgents();
    }
    root.querySelector(".call-dialog-backdrop")?.remove();
  }));
}
function conversationProfile() {
  const log = String(state.active?.log || "");
  const lines = log.split(/\n+/).map((line) => line.replace(/^.{1,16}[：:]\s*/, "").trim()).filter(Boolean);
  const average = lines.length ? Math.round(lines.reduce((sum, line) => sum + line.length, 0) / lines.length) : 18;
  const endings = lines.map((line) => line.match(/([哈呀啦呢吧嘛哦诶呗]+[。！？!?…~～]*)$/)?.[1]).filter(Boolean);
  const commonEnding = endings.sort((a, b) => endings.filter((v) => v === b).length - endings.filter((v) => v === a).length)[0] || "";
  return `平均每条约 ${Math.min(40, Math.max(6, average))} 字${commonEnding ? `，常用句尾“${commonEnding}”` : ""}`;
}
function memoryContext() {
  const recent = state.turns.slice(-12).map((item) => `${item.role === "user" ? "用户" : state.active?.name}：${item.content}`).join("\n") || "暂无";
  const episodes = (state.active?.episodicMemories || []).slice(0, 8).map((item) => `- ${item.text}（记录于 ${new Date(item.createdAt || Date.now()).toLocaleDateString("zh-CN")}）`).join("\n") || "暂无";
  const long = (state.active?.memories || []).slice(0, 12).map((item) => `- ${item.text}${item.locked ? "（用户锁定）" : ""}`).join("\n") || "暂无";
  return `【当前上下文】\n${recent}\n【事件记忆】\n${episodes}\n【长期记忆】\n${long}`;
}
function cleanReply(value) {
  let text = String(value || "")
    .replace(/（[^）]{0,40}）|\([^)]{0,40}\)|\[[^\]]{0,40}\]/g, "")
    .replace(/^(?:AI|助手|回复)[：:]\s*/i, "")
    .replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > 120) {
    const short = text.slice(0, 120);
    const end = Math.max(short.lastIndexOf("。"), short.lastIndexOf("！"), short.lastIndexOf("？"), short.lastIndexOf("\n"));
    text = (end > 35 ? short.slice(0, end + 1) : short).trim();
  }
  return text;
}
async function requestFast() {
  const recentReplies = state.turns.filter((turn) => turn.role === "assistant").slice(-3).map((turn) => turn.content).join("｜");
  const callRule = state.callActive ? "当前是实时语音通话：先回应重点，只说1至2个短句，第一句8至18字，总计不超过45个汉字。" : "像即时聊天一样自然简短，通常1至3句且不超过80个汉字。";
  const instruction = `你是“回声”中的 AI 模拟角色。模仿“${state.active.name}”的文字表达风格，但不得声称自己是真人。${callRule}不要输出括号动作、旁白、舞台说明或情绪标签。不要重复问候和最近用过的句式。主动结合三层记忆。当前时间是 ${new Date().toLocaleString("zh-CN")}，关系阶段为“${relationshipStage(state.active)}”，距离上次联系：${lastContactText(state.active)}。${emotionPrompt(state.active)}对尚未发生或结果未知的计划只能自然追问，不能假装已经知道结果。关系阶段只调整熟悉程度，不允许捏造共同经历。\n风格统计：${conversationProfile()}\n三层记忆：\n${memoryContext()}\n最近回复（避免重复）：${recentReplies || "无"}\n参考聊天记录：\n${state.active.log.slice(0, 6000)}`;
  return requestArk({ instructions: instruction, messages: arkConversationMessages(state.turns.slice(-20)), maxOutputTokens: state.callActive ? 80 : 140 });
}
async function generateReply() {
  if (state.busy || !state.active) return;
  const operationId = ++state.generationId;
  state.busy = true; state.error = ""; state.fallbackNotice = "";
  state.phase = "正在理解你的消息";
  syncChatGeneration();
  clearInterval(generationPhaseTimer);
  const phases = ["正在理解你的消息", "正在回想你们的聊天", "正在组织这句话"];
  let phaseIndex = 0;
  generationPhaseTimer = window.setInterval(() => {
    if (!state.busy || operationId !== state.generationId) return clearInterval(generationPhaseTimer);
    state.phase = phases[Math.min(++phaseIndex, phases.length - 1)];
    const label = root.querySelector(".generation-status span");
    if (label) label.textContent = state.phase;
  }, 1250);
  try {
    let reply = await requestFast();
    if (operationId !== state.generationId) return;
    reply = cleanReply(reply);
    if (state.callActive) {
      const firstEnd = reply.search(/[。！？!?]/);
      if (firstEnd >= 8 && firstEnd < 36) reply = reply.slice(0, firstEnd + 1);
      else if (reply.length > 36) reply = `${reply.slice(0, 36).replace(/[，,、]$/, "")}。`;
    }
    if (!reply) throw new Error("模型没有返回内容");
    clearInterval(generationPhaseTimer);
    state.phase = "正在组织回应";
    const completed = state.callActive ? appendCompletedReply(String(reply).trim(), operationId) : await revealReply(String(reply).trim(), operationId);
    if (!completed) return;
    updateRelationship(state.active, 2);
    const sharedPhoto = [...state.turns].reverse().find((turn) => turn.role === "user" && turn.imageData && !turn.photoMemorySaved);
    if (sharedPhoto) {
      sharedPhoto.photoMemorySaved = true;
      state.active.episodicMemories ||= [];
      state.active.episodicMemories.unshift({ id: `photo-${Date.now()}`, text: `一起看过一张照片：${sharedPhoto.content || String(reply).slice(0, 48)}`, createdAt: Date.now(), automatic: true, source: "photo", status: "completed" });
    }
    state.active.turns = state.turns.map(({role, content, createdAt, timestampEstimated, inputType, imageData, imageMime, photoMemorySaved, proactive, proactiveReason, reminderAt, reminderStatus, notificationId}) => ({role, content, createdAt, timestampEstimated, inputType, imageData, imageMime, photoMemorySaved, proactive, proactiveReason, reminderAt, reminderStatus, notificationId})); await saveAgents();
    if (state.active.proactive?.enabled) void scheduleRollingProactiveNotifications();
    state.busy = false; state.phase = ""; syncChatGeneration();
    const lastAssistant = state.turns.findLastIndex((turn) => turn.role === "assistant");
    const wrapper = root.querySelector(`[data-message-index="${lastAssistant}"]`)?.closest(".message-wrap");
    if (wrapper) { wrapper.outerHTML = messageMarkup(state.turns[lastAssistant], lastAssistant, false); bindMessageInteractions(); }
    if (state.callActive) {
      state.callPhase = state.active.voiceReady ? "正在准备第一句话" : "对方正在说话"; state.callCaption = `${state.active.name}：${reply}`; syncCallUI();
      if (state.active.voiceReady) await speak(reply, state.active.voiceId);
      else await speakSystemVoice(reply);
      if (state.callActive) setTimeout(() => callListen(), 450);
    } else if (state.active.voiceReady && !state.muteOnce) speak(reply, state.active.voiceId);
    state.muteOnce = false;
  } catch (err) {
    clearInterval(generationPhaseTimer);
    if (operationId !== state.generationId) return;
    state.error = err.message || "连接失败";
    state.busy = false; state.phase = ""; syncChatGeneration();
  }
}
function appendCompletedReply(reply, operationId) {
  if (operationId !== state.generationId) return false;
  const message = { role: "assistant", content: reply, streaming: false, createdAt: Date.now() };
  state.turns.push(message); appendChatMessage(message, state.turns.length - 1); return true;
}
async function speakSystemVoice(text) {
  try { await EchoSpeech.speak({ text, locale: "zh-CN" }); return; } catch {}
  await new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "zh-CN";
    utterance.onend = resolve; utterance.onerror = resolve; window.speechSynthesis.speak(utterance);
  });
}
async function revealReply(reply, operationId) {
  const firstStop = reply.search(/[。！？!?\n]/);
  const firstLength = firstStop >= 0 ? firstStop + 1 : Math.min(reply.length, 14);
  const message = { role: "assistant", content: reply.slice(0, firstLength), streaming: firstLength < reply.length, createdAt: Date.now() };
  state.turns.push(message);
  state.phase = "正在输入";
  const index = state.turns.length - 1;
  appendChatMessage(message, index);
  syncChatGeneration();
  if (firstLength < reply.length) await new Promise((resolve) => setTimeout(resolve, 110));
  for (let cursor = firstLength; cursor < reply.length; cursor += 4) {
    if (operationId !== state.generationId) return false;
    message.content = reply.slice(0, Math.min(reply.length, cursor + 4));
    const text = root.querySelector(`[data-message-index="${index}"] .message-text`);
    if (text) text.textContent = message.content;
    keepChatAtBottom(root.querySelector(".msgs"));
    const last = message.content.at(-1);
    await new Promise((resolve) => setTimeout(resolve, /[。！？!?\n]/.test(last) ? 90 : 18));
  }
  message.content = reply;
  message.streaming = false;
  return true;
}
async function stopGeneration() {
  if (!state.busy) return;
  clearInterval(generationPhaseTimer);
  state.generationId++;
  const last = state.turns.at(-1);
  if (last?.streaming) {
    last.streaming = false;
    if (!last.content.trim()) state.turns.pop();
  }
  state.busy = false; state.phase = ""; state.error = "已停止生成";
  state.active.turns = state.turns.map(({role, content, createdAt, timestampEstimated, inputType, imageData, imageMime, photoMemorySaved, proactive, proactiveReason, reminderAt, reminderStatus, notificationId}) => ({role, content, createdAt, timestampEstimated, inputType, imageData, imageMime, photoMemorySaved, proactive, proactiveReason, reminderAt, reminderStatus, notificationId}));
  await saveAgents(); syncChatGeneration();
  const stoppedIndex = state.turns.length - 1;
  const wrapper = root.querySelector(`[data-message-index="${stoppedIndex}"]`)?.closest(".message-wrap");
  if (wrapper && state.turns[stoppedIndex]) { wrapper.outerHTML = messageMarkup(state.turns[stoppedIndex], stoppedIndex, false); bindMessageInteractions(); }
}
async function speak(text, voiceId) {
  const operationId = ++state.voiceGenerationId;
  state.speaking = true; state.voicePhase = "正在生成第一句话"; syncVoiceGeneration();
  try {
    const chunks = splitSpeechText(cleanReply(text));
    let pending = requestSpeechChunk(chunks[0], voiceId);
    for (let index = 0; index < chunks.length; index++) {
      const audio = await pending;
      if (operationId !== state.voiceGenerationId) return;
      pending = index + 1 < chunks.length ? requestSpeechChunk(chunks[index + 1], voiceId) : null;
      state.voicePhase = `正在播放 ${index + 1}/${chunks.length}`; syncVoiceGeneration();
      if (state.callActive) { state.callPhase = "对方正在说话"; syncCallUI(); }
      await playSpeechAudio(audio, operationId);
      if (operationId !== state.voiceGenerationId) return;
    }
  } catch (error) {
    console.warn("[voice] synthesis failed", error);
    state.error = "声音生成失败，文字对话不受影响";
    syncChatGeneration();
  }
  finally { if (operationId === state.voiceGenerationId) { state.speaking = false; state.voicePhase = ""; state.currentPlayer = null; syncVoiceGeneration(); } }
}
function stopVoice() {
  state.voiceGenerationId++;
  if (state.currentPlayer) { state.currentPlayer.pause(); state.currentPlayer.src = ""; state.currentPlayer = null; }
  state.speaking = false; state.voicePhase = ""; syncVoiceGeneration();
}
function unlockVoiceAudio() {
  try {
    voiceAudioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (voiceAudioContext.state === "suspended") voiceAudioContext.resume().catch(() => {});
  } catch {}
}
async function playStreamingSpeech(text, voiceId) {
  try {
    await playRawStreamingSpeech(text, voiceId);
  } catch {
    const chunks = splitSpeechText(text);
    let pending = requestSpeechChunk(chunks[0], voiceId);
    for (let index = 0; index < chunks.length; index++) {
      const audio = await pending;
      pending = index + 1 < chunks.length ? requestSpeechChunk(chunks[index + 1], voiceId) : null;
      await playSpeechAudio(audio);
    }
  }
}
async function playRawStreamingSpeech(text, voiceId) {
  const response = await fetch(`${state.settings.computer.replace(/\/$/, "")}/voice/stream`, {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify({ voiceId, text })
  });
  if (!response.ok || !response.body) throw new Error("voice stream failed");
  const reader = response.body.getReader();
  unlockVoiceAudio();
  const context = voiceAudioContext;
  if (!context) throw new Error("Web Audio unavailable");
  await context.resume();
  let bytes = new Uint8Array(0);
  let sampleRate = 24000;
  let headerRead = false;
  let playAt = context.currentTime + 0.06;
  let lastSource = null;
  while (true) {
    const { value, done } = await reader.read();
    if (value?.length) {
      const merged = new Uint8Array(bytes.length + value.length);
      merged.set(bytes); merged.set(value, bytes.length); bytes = merged;
    }
    if (!headerRead && bytes.length >= 8) {
      if (String.fromCharCode(...bytes.slice(0, 4)) !== "ECHO") throw new Error("invalid voice stream");
      sampleRate = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true);
      bytes = bytes.slice(8); headerRead = true;
    }
    const pcmLength = bytes.length - (bytes.length % 2);
    if (headerRead && pcmLength) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, pcmLength);
      const buffer = context.createBuffer(1, pcmLength / 2, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      bytes = bytes.slice(pcmLength);
      const source = context.createBufferSource();
      source.buffer = buffer; source.connect(context.destination);
      playAt = Math.max(playAt, context.currentTime + 0.025);
      source.start(playAt); playAt += buffer.duration; lastSource = source;
    }
    if (done) break;
  }
  if (lastSource) await new Promise((resolve) => lastSource.addEventListener("ended", resolve, { once: true }));
}
function splitSpeechText(text) {
  const sentences = String(text).replace(/\s+/g, " ").match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const limit = state.callActive ? 12 : 18;
    if (current && current.length + sentence.length > limit) { chunks.push(current.trim()); current = ""; }
    current += sentence;
    while (current.length > limit) {
      const window = current.slice(0, limit);
      const comma = Math.max(window.lastIndexOf("，"), window.lastIndexOf(","));
      const cut = comma >= 8 ? comma + 1 : limit;
      chunks.push(current.slice(0, cut).trim());
      current = current.slice(cut);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length > 1 && chunks.at(-1).length < 5 && chunks.at(-2).length + chunks.at(-1).length <= 24) {
    chunks.splice(-2, 2, chunks.at(-2) + chunks.at(-1));
  }
  return (chunks.length ? chunks : [String(text).trim()]).map((chunk) => /[。！？!?]$/.test(chunk) ? chunk : `${chunk.replace(/[，,]$/, "")}。`);
}
async function requestSpeechChunk(text, voiceId) {
  const emotion = currentEmotion(state.active);
  const instruction = state.callActive
    ? `像熟悉的人打电话一样自然、亲近地说，节奏略快，停顿短，情绪${emotion?.label || "温和"}，不要播音腔。`
    : `自然聊天语气，保留真实呼吸和轻微情绪起伏，情绪${emotion?.label || "温和"}，不要播音腔。`;
  const response = await CapacitorHttp.post({
    url: `${state.settings.computer.replace(/\/$/, "")}/voice/synthesize`,
    headers: bridgeHeaders(),
    data: { voiceId, text, instruction },
    // CosyVoice normally responds in one or two seconds, but a cold GPU or a
    // long first chunk must not be mistaken for a failed voice request.
    connectTimeout: 8000,
    readTimeout: 180000
  });
  let data = response.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  if (response.status !== 200 || !data?.audio) {
    const detail = String(data?.detail || data?.error || `HTTP ${response.status}`);
    throw new Error(`voice synthesis failed: ${detail}`);
  }
  return data.audio;
}
function playSpeechAudio(audio, operationId = state.voiceGenerationId) {
  return new Promise((resolve, reject) => {
    const player = new Audio(`data:audio/wav;base64,${audio}`);
    state.currentPlayer = player;
    player.addEventListener("ended", resolve, { once: true });
    player.addEventListener("pause", () => operationId !== state.voiceGenerationId && resolve(), { once: true });
    player.addEventListener("error", reject, { once: true });
    player.play().catch(reject);
  });
}
async function saveSettings() {
  state.settings.key = root.querySelector("#apiKey").value.trim(); state.settings.computer = root.querySelector("#computer").value.trim();
  await Promise.all([Preferences.set({ key: "ark_api_key", value: state.settings.key }), Preferences.set({ key: "computer_url", value: state.settings.computer })]); state.view = "home"; render();
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  const changed = await materializeDueReminders();
  if (changed) syncMaterializedMessages();
  if (Date.now() - Number(state.proactiveScheduledAt || 0) > 6 * 3600000) await scheduleRollingProactiveNotifications();
});
load();
