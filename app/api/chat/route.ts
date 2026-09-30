export const runtime = "edge";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { agentName?: string; relation?: string; chatLog?: string; mode?: "fast" | "pro"; messages?: ChatMessage[] };
    const messages = (body.messages || []).filter((m) => m.content?.trim()).slice(-20);
    if (!messages.length) return Response.json({ error: "消息不能为空" }, { status: 400 });
    const mode = body.mode === "pro" ? "pro" : "fast";
    const system = `你是“回声”应用里的 AI 模拟智能体。请模仿“${body.agentName || "对方"}”的表达风格与用户聊天。你们的关系：${body.relation || "重要的人"}。只学习措辞、句长、语气、口头禅和表情习惯，不编造记忆，不声称自己是真人；被问及时明确说明是 AI 模拟。回复自然、简短。\n\n风格参考聊天记录：\n${(body.chatLog || "暂无样本").slice(0, 6000)}`;
    const url = mode === "fast" ? "https://api.deepseek.com/chat/completions" : `${(process.env.WECLONE_API_URL || "http://127.0.0.1:8005/v1").replace(/\/$/, "")}/chat/completions`;
    const apiKey = mode === "fast" ? process.env.DEEPSEEK_API_KEY : undefined;
    if (mode === "fast" && !apiKey) return Response.json({ error: "快速档尚未配置 DeepSeek API Key", code: "DEEPSEEK_KEY_MISSING" }, { status: 503 });
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: mode === "fast" ? "deepseek-v4-flash" : (process.env.WECLONE_MODEL || "weclone-local"), temperature: 0.75, max_tokens: 300, thinking: mode === "fast" ? { type: "disabled" } : undefined, messages: [{ role: "system", content: system }, ...messages] }),
      signal: AbortSignal.timeout(mode === "fast" ? 45_000 : 120_000),
    });
    if (!upstream.ok) throw new Error(`${mode === "fast" ? "DeepSeek" : "WeClone"} 返回 ${upstream.status}`);
    const data = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("模型没有返回内容");
    return Response.json({ reply, mode });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    return Response.json({ error: "模型服务暂时不可用", detail }, { status: 503 });
  }
}
