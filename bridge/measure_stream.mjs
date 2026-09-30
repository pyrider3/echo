const started = performance.now();
const response = await fetch("http://127.0.0.1:8006/voice/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ voiceId: "testvoice", text: process.argv[2] || "你好，我一直都在这里，今天过得怎么样？" }),
});
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
let received = 0;
let firstAudioMs = null;
for await (const chunk of response.body) {
  received += chunk.length;
  if (firstAudioMs === null && received > 8) firstAudioMs = performance.now() - started;
}
console.log(JSON.stringify({ firstAudioMs: Math.round(firstAudioMs), totalMs: Math.round(performance.now() - started), bytes: received }));
