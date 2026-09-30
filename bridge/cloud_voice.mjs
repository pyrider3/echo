const MODEL = "cosyvoice-v3.5-flash";

function apiError(status, body) {
  const detail = body?.message || body?.code || body?.error?.message || `HTTP ${status}`;
  return new Error(`阿里云语音请求失败：${detail}`);
}

export function createAliyunVoiceProvider({ apiKey, workspaceId, fetchImpl = fetch }) {
  const key = String(apiKey || "").trim();
  const workspace = String(workspaceId || "").trim();
  const base = workspace ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts` : "";
  const request = async (path, payload, timeout = 120000) => {
    if (!key || !workspace) throw new Error("云端语音尚未配置 DASHSCOPE_API_KEY 和 DASHSCOPE_WORKSPACE_ID");
    const response = await fetchImpl(`${base}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });
    const raw = await response.text();
    let data = {}; try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 300) }; }
    if (!response.ok) throw apiError(response.status, data);
    return data;
  };
  return {
    model: MODEL,
    configured: Boolean(key && workspace),
    async clone({ publicUrl, prefix = "echo", language = "zh" }) {
      const data = await request("customization", {
        model: "voice-enrollment",
        input: {
          action: "create_voice", target_model: MODEL,
          prefix: String(prefix).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "echo",
          url: publicUrl, language_hints: [language], max_prompt_audio_length: 30,
          enable_preprocess: true, enable_volume_normalization: "true",
        },
      });
      const voiceId = data?.output?.voice_id || data?.output?.voiceId;
      if (!voiceId) throw new Error("云端已处理样本，但没有返回音色 ID");
      return voiceId;
    },
    async synthesize({ voiceId, text, instruction }) {
      const data = await request("SpeechSynthesizer", {
        model: MODEL,
        input: { text, voice: voiceId, format: "wav", sample_rate: 24000, ...(instruction ? { instruction } : {}) },
      });
      const audioUrl = data?.output?.audio?.url || data?.output?.url || data?.audio?.url;
      if (!audioUrl) throw new Error("云端语音没有返回音频地址");
      const audioResponse = await fetchImpl(audioUrl, { signal: AbortSignal.timeout(60000) });
      if (!audioResponse.ok) throw new Error(`下载云端语音失败：HTTP ${audioResponse.status}`);
      return Buffer.from(await audioResponse.arrayBuffer());
    },
  };
}
