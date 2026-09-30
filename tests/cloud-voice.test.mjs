import test from "node:test";
import assert from "node:assert/strict";
import { createAliyunVoiceProvider } from "../bridge/cloud_voice.mjs";

test("cloud voice clone returns the provider voice id without exposing credentials", async () => {
  let request;
  const provider = createAliyunVoiceProvider({
    apiKey: "secret-key", workspaceId: "workspace-1",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ output: { voice_id: "cosyvoice-cloud-123" } }), { status: 200 });
    },
  });
  assert.equal(await provider.clone({ publicUrl: "https://example.com/sample/token", prefix: "Echo!01" }), "cosyvoice-cloud-123");
  assert.match(request.url, /workspace-1\.cn-beijing\.maas\.aliyuncs\.com/);
  assert.equal(JSON.parse(request.options.body).input.prefix, "echo01");
  assert.doesNotMatch(request.options.body, /secret-key/);
});

test("cloud synthesis downloads and returns generated audio bytes", async () => {
  const calls = [];
  const provider = createAliyunVoiceProvider({
    apiKey: "key", workspaceId: "workspace",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes("SpeechSynthesizer")) return new Response(JSON.stringify({ output: { audio: { url: "https://cdn.example/audio.wav" } } }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    },
  });
  const audio = await provider.synthesize({ voiceId: "voice-1", text: "你好", instruction: "自然地说" });
  assert.deepEqual([...audio], [1, 2, 3]);
  assert.equal(JSON.parse(calls[0].options.body).input.instruction, "自然地说");
});
