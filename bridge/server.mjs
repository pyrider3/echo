import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createAliyunVoiceProvider } from "./cloud_voice.mjs";

// Read per request: rollback takes effect without interrupting text chat.
function voiceService() {
  try {
    const engine = readFileSync(new URL("../work/voice-engine.txt", import.meta.url), "utf8").trim();
    if (engine === "cosyvoice") return "http://127.0.0.1:8009";
  } catch {}
  return "http://127.0.0.1:8007";
}

const port = Number(process.env.ECHO_BRIDGE_PORT || 8006);
const weclone = (process.env.WECLONE_API_URL || "http://127.0.0.1:8005/v1").replace(/\/$/, "");
const professionalService = (process.env.ECHO_PRO_URL || "http://127.0.0.1:8008").replace(/\/$/, "");
const accessToken = String(process.env.ECHO_BRIDGE_TOKEN || "").trim();
const voiceProviderName = String(process.env.ECHO_VOICE_PROVIDER || "local").toLowerCase();
const allowLocalVoiceFallback = String(process.env.ECHO_ALLOW_LOCAL_VOICE_FALLBACK || "false").toLowerCase() === "true";
const publicBaseUrl = String(process.env.ECHO_PUBLIC_BASE_URL || "https://arichm.dpdns.org").replace(/\/$/, "");
const aliyunVoice = createAliyunVoiceProvider({ apiKey: process.env.DASHSCOPE_API_KEY, workspaceId: process.env.DASHSCOPE_WORKSPACE_ID });
const referenceFiles = new Map();
const requestLog = new Map();
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Echo-Token",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function authorized(req) {
  if (!accessToken) return true;
  return req.headers["x-echo-token"] === accessToken;
}

function rateLimited(req) {
  const key = String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  const recent = (requestLog.get(key) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  requestLog.set(key, recent);
  return recent.length > 40;
}

function normalizeMessages(body) {
  const memories = Array.isArray(body.memories) ? body.memories.slice(0, 12).map((item) => `- ${String(item?.text || "").slice(0, 100)}`).join("\n") : "暂无";
  const recentReplies = (body.messages || []).filter((item) => item?.role === "assistant").slice(-3).map((item) => item.content).join("｜");
  const instruction = `你是“回声”应用中的 AI 模拟智能体。模仿“${body.agentName || "对方"}”的文字表达风格，但不得冒充真人。像微信聊天一样自然简短，通常回复 1–3 句并控制在 80 个汉字以内。不要输出括号动作、旁白、舞台说明或情绪标签。避免重复问候和最近已经使用的句式。结合当前对话的短期上下文与长期记忆回应。\n风格统计：${String(body.styleProfile || "遵循参考记录").slice(0, 300)}\n长期记忆：\n${memories}\n最近回复（避免重复）：${recentReplies || "无"}\n参考聊天记录：\n${String(body.chatLog || "").slice(0, 6000)}\n\n当前对话：`;
  const source = (body.messages || [])
    .filter((item) => item && ["user", "assistant"].includes(item.role) && String(item.content || "").trim())
    .slice(-20);

  while (source[0]?.role === "assistant") source.shift();
  const normalized = [];
  for (const item of source) {
    const content = String(item.content).trim();
    const previous = normalized.at(-1);
    if (previous?.role === item.role) previous.content += `\n${content}`;
    else normalized.push({ role: item.role, content });
  }
  if (!normalized.length || normalized.at(-1)?.role !== "user") {
    normalized.push({ role: "user", content: "你好" });
  }
  normalized[0].content = `${instruction}\n${normalized[0].content}`;
  if (body.callMode) normalized[0].content = `【实时语音通话】直接回应重点，只说一个8至30字的短句，不要长篇解释。\n${normalized[0].content}`;
  return normalized;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, headers); return res.end(); }
  const referenceMatch = String(req.url || "").match(/^\/voice\/reference-file\/([a-f0-9]{64})$/);
  if (referenceMatch && req.method === "GET") {
    const file = referenceFiles.get(referenceMatch[1]);
    if (!file || file.expiresAt < Date.now()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": file.mime, "Content-Length": file.data.length, "Cache-Control": "no-store" });
    return res.end(file.data);
  }
  if (req.url === "/health") {
    let professional = { ok: false, baseModelReady: false };
    try {
      const response = await fetch(`${professionalService}/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) professional = await response.json();
    } catch {}
    res.writeHead(200, headers);
    return res.end(JSON.stringify({ ok: true, service: "echo-computer-bridge", protected: Boolean(accessToken), professional, voice: { provider: voiceProviderName, configured: voiceProviderName === "aliyun" ? aliyunVoice.configured : true, model: voiceProviderName === "aliyun" ? aliyunVoice.model : "local" } }));
  }
  if (!authorized(req)) { res.writeHead(401, headers); return res.end(JSON.stringify({ error: "unauthorized" })); }
  if (rateLimited(req)) { res.writeHead(429, headers); return res.end(JSON.stringify({ error: "too many requests" })); }

  if ((req.url === "/professional/train" || /^\/professional\/train\/[a-zA-Z0-9_-]+$/.test(req.url || "")) && ["GET", "POST"].includes(req.method || "")) {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const path = String(req.url).replace(/^\/professional/, "");
      const response = await fetch(`${professionalService}${path}`, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.text();
      res.writeHead(response.status, headers);
      return res.end(data);
    } catch (error) {
      res.writeHead(503, headers);
      return res.end(JSON.stringify({ error: "Professional training service unavailable", detail: error instanceof Error ? error.message : "unknown" }));
    }
  }

  if (req.url === "/voice/stream" && req.method === "POST") {
    if (voiceProviderName === "aliyun") { res.writeHead(501, headers); return res.end(JSON.stringify({ error: "云端语音使用分段预取播放" })); }
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(`${voiceService()}/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(180000),
      });
      if (!response.ok || !response.body) {
        const detail = await response.text();
        res.writeHead(response.status, headers); return res.end(detail);
      }
      res.writeHead(200, {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
        for await (const chunk of response.body) res.write(chunk);
      return res.end();
    } catch (error) {
      if (res.headersSent) return res.destroy(error instanceof Error ? error : undefined);
      res.writeHead(503, headers);
      return res.end(JSON.stringify({ error: "Voice stream unavailable", detail: error instanceof Error ? error.message : "unknown" }));
    }
  }

  if (["/voice/reference", "/voice/synthesize", "/voice/warm"].includes(req.url || "") && req.method === "POST") {
    if (voiceProviderName === "aliyun") {
      try {
        if (!aliyunVoice.configured) throw new Error("云端语音尚未配置，请在 bridge/.env.local 中填写阿里云凭证");
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (req.url === "/voice/warm") { res.writeHead(200, headers); return res.end(JSON.stringify({ ok: true, provider: "aliyun" })); }
        if (req.url === "/voice/reference") {
          const audio = Buffer.from(String(body.audio || ""), "base64");
          if (!audio.length || audio.length > 20 * 1024 * 1024) throw new Error("音色样本为空或超过 20MB");
          const token = randomBytes(32).toString("hex");
          referenceFiles.set(token, { data: audio, mime: String(body.mime || "audio/mpeg"), expiresAt: Date.now() + 10 * 60_000 });
          try {
            const voiceId = await aliyunVoice.clone({ publicUrl: `${publicBaseUrl}/voice/reference-file/${token}`, prefix: `echo${Date.now().toString(36).slice(-5)}` });
            res.writeHead(200, headers); return res.end(JSON.stringify({ ok: true, voiceId, provider: "aliyun", model: aliyunVoice.model }));
          } finally { setTimeout(() => referenceFiles.delete(token), 60_000).unref?.(); }
        }
        const audio = await aliyunVoice.synthesize({ voiceId: String(body.voiceId || ""), text: String(body.text || "").slice(0, 500), instruction: String(body.instruction || "").slice(0, 200) });
        res.writeHead(200, headers); return res.end(JSON.stringify({ audio: audio.toString("base64"), provider: "aliyun" }));
      } catch (error) {
        if (allowLocalVoiceFallback) console.warn(`[voice] cloud failed, local fallback enabled: ${error.message}`);
        else { res.writeHead(503, headers); return res.end(JSON.stringify({ error: "Cloud voice unavailable", detail: error instanceof Error ? error.message : "unknown" })); }
      }
    }
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const path = req.url === "/voice/reference" ? "/reference" : req.url === "/voice/warm" ? "/warm" : "/synthesize";
      const response = await fetch(`${voiceService()}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(180000),
      });
      const data = await response.text(); res.writeHead(response.status, headers); return res.end(data);
    } catch (error) {
      res.writeHead(503, headers);
      return res.end(JSON.stringify({ error: "Voice service unavailable", detail: error instanceof Error ? error.message : "unknown" }));
    }
  }

  if (req.url !== "/chat" || req.method !== "POST") {
    res.writeHead(404, headers); return res.end(JSON.stringify({ error: "not found" }));
  }

  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const messages = normalizeMessages(body);
    console.log(`[chat] ${new Date().toISOString()} agent=${String(body.agentName || "").slice(0, 40)} input=${body.messages?.length || 0} normalized=${messages.length} logChars=${String(body.chatLog || "").length}`);
    const response = await fetch(`${professionalService}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: String(body.agentId || ""), temperature: .72, max_tokens: body.callMode ? 72 : 140, messages }),
      signal: AbortSignal.timeout(240000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`WeClone ${response.status}: ${raw.slice(0, 300)}`);
    const data = JSON.parse(raw);
    const reply = String(data.choices?.[0]?.message?.content || "")
      .replace(/（[^）]{0,40}）|\([^)]{0,40}\)|\[[^\]]{0,40}\]/g, "")
      .replace(/\n{3,}/g, "\n\n").trim();
    res.writeHead(200, headers);
    res.end(JSON.stringify({ reply }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`[chat:error] ${new Date().toISOString()} ${detail}`);
    res.writeHead(503, headers);
    res.end(JSON.stringify({ error: "WeClone unavailable", detail }));
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Echo bridge listening on 0.0.0.0:${port} token=${accessToken ? "enabled" : "disabled"}`));
