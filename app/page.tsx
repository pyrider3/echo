"use client";

import { useEffect, useMemo, useState } from "react";

type Agent = { id?: number; name: string; relation: string; voice: boolean; color: string; modelMode: "fast" | "pro"; chatLog?: string };
type Turn = { role: "user" | "assistant"; content: string };
const sample = `我：你到家了吗？\n阿泽：刚到，今天路上堵得离谱\n我：吃饭没\n阿泽：还没呢，你又要催我了是吧哈哈\n我：少贫，快去吃\n阿泽：知道啦知道啦，你也是`;

const starterAgents: Agent[] = [
  { name: "阿泽", relation: "老朋友", voice: true, color: "violet", modelMode: "pro", chatLog: sample },
  { name: "妈妈", relation: "家人", voice: false, color: "peach", modelMode: "fast", chatLog: sample },
];

export default function Home() {
  const [view, setView] = useState<"home" | "create" | "chat">("home");
  const [step, setStep] = useState(1);
  const [log, setLog] = useState("");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [voice, setVoice] = useState(false);
  const [modelMode, setModelMode] = useState<"fast" | "pro">("fast");
  const [agents, setAgents] = useState(starterAgents);
  const [active, setActive] = useState<Agent>(starterAgents[0]);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Turn[]>([{ role: "user", content: "今天过得怎么样？" }, { role: "assistant", content: "还行，就是有点累，你呢" }]);
  const [replying, setReplying] = useState(false);
  const [chatError, setChatError] = useState("");
  const progress = useMemo(() => (step / 5) * 100, [step]);

  useEffect(() => {
    fetch("/api/agents").then((r) => r.ok ? r.json() : Promise.reject()).then((data) => {
      if (data.agents?.length) setAgents(data.agents.map((a: { id: number; name: string; relation: string; voiceEnabled: boolean; modelMode?: "fast" | "pro"; chatLog?: string }, i: number) => ({ id: a.id, name: a.name, relation: a.relation, voice: a.voiceEnabled, modelMode: a.modelMode || "fast", chatLog: a.chatLog, color: i % 2 ? "peach" : "violet" })));
    }).catch(() => {});
  }, []);

  function openCreate() { setView("create"); setStep(1); }
  async function openAgent(agent: Agent) {
    setActive(agent); setView("chat");
    if (!agent.id) return;
    try {
      const response = await fetch(`/api/agents/${agent.id}/messages`);
      const data = await response.json();
      setMessages(data.messages?.length ? data.messages.map((m: Turn) => ({ role: m.role, content: m.content })) : [{ role: "assistant", content: `嗨，我是${agent.name}。想聊点什么？` }]);
    } catch { setMessages([{ role: "assistant", content: `嗨，我是${agent.name}。想聊点什么？` }]); }
  }
  async function finish() {
    const draft: Agent = { name: name || "新的回声", relation: relation || "重要的人", voice, modelMode, chatLog: log, color: agents.length % 2 ? "violet" : "peach" };
    let agent: Agent = draft;
    try {
      const response = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, chatLog: log, voiceEnabled: voice, modelMode }) });
      if (response.ok) { const data = await response.json(); agent = { ...draft, id: data.agent.id }; }
    } catch {}
    setAgents((a) => [...a, agent]); setActive(agent); setView("chat"); setMessages([{ role: "assistant", content: `嗨，我是${agent.name}。想聊点什么？` }]);
  }
  async function send() {
    if (!message.trim()) return;
    const content = message.trim(); const next: Turn[] = [...messages, { role: "user", content }]; setMessages(next); setMessage(""); setReplying(true); setChatError("");
    if (active.id) await fetch(`/api/agents/${active.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "user", content }) }).catch(() => {});
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentName: active.name, relation: active.relation, chatLog: active.chatLog, mode: active.modelMode, messages: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error);
      const reply = data.reply as string;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (active.id) await fetch(`/api/agents/${active.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "assistant", content: reply }) }).catch(() => {});
    } catch { setChatError(active.modelMode === "fast" ? "快速档尚未配置 DeepSeek API Key，或服务暂时不可用。" : "连接不到本机 WeClone，请先启动模型服务后重试。"); }
    finally { setReplying(false); }
  }

  return <main>
    <header className="topbar">
      <button className="brand" onClick={() => setView("home")}><span className="orb"/>回声 <small>ECHO</small></button>
      <div className="nav"><span className="secure">● 本地加密</span><button className="avatar">你</button></div>
    </header>

    {view === "home" && <>
      <section className="hero">
        <div className="echo-art" aria-hidden="true"><i/><i/><i/><b/><span className="memory m1">在吗</span><span className="memory m2">晚安</span><span className="memory m3">到家叫我</span><span className="memory m4">哈哈哈</span><span className="memory m5">别熬夜</span><span className="memory m6">知道啦</span></div>
        <p className="eyebrow">把记忆里的对话，变成可以回应的回声</p>
        <h1>让熟悉的声音，<br/><em>再次回应你</em></h1>
        <p className="lead">粘贴聊天记录，AI 学习对方的表达习惯。你可以继续用文字交流，也可以在获得授权后加入声音。</p>
        <button className="primary big" onClick={openCreate}>＋ 创建一个回声</button>
        <p className="privacy">你的内容仅用于创建专属智能体，不会公开展示</p>
      </section>
      <section className="agents">
        <div className="section-head"><div><span>MY ECHOES</span><h2>我的智能体</h2></div><button className="text-btn" onClick={openCreate}>新建回声 →</button></div>
        <div className="agent-grid">
          {agents.map((a, i) => <button className="agent-card" key={a.id ?? i} onClick={() => openAgent(a)}>
            <div className={`agent-orb ${a.color}`}><span>{a.name[0]}</span></div>
            <div><h3>{a.name}</h3><p>{a.relation} · {a.voice ? "已添加声音" : "文字对话"}</p></div><span className="arrow">↗</span>
          </button>)}
          <button className="agent-card add" onClick={openCreate}><span className="plus">＋</span><div><h3>创建新的回声</h3><p>从一段聊天记录开始</p></div></button>
        </div>
      </section>
    </>}

    {view === "create" && <section className="wizard">
      <button className="back" onClick={() => step > 1 ? setStep(step - 1) : setView("home")}>← 返回</button>
      <div className="progress"><span style={{width: `${progress}%`}}/></div><p className="step-label">STEP {step} / 5</p>
      {step === 1 && <div className="card"><p className="kicker">01 · 对话记忆</p><h2>粘贴你们的聊天记录</h2><p className="hint">不需要整理格式，原样粘贴就好。内容越丰富，表达风格越贴近。</p><textarea value={log} onChange={e=>setLog(e.target.value)} placeholder="在这里粘贴微信、短信或其他聊天记录…"/><div className="field-foot"><button className="sample" onClick={()=>setLog(sample)}>使用示例</button><span>{log.length} 字</span></div><button className="primary full" disabled={log.length < 20} onClick={()=>setStep(2)}>下一步：认识这个人 →</button></div>}
      {step === 2 && <div className="card"><p className="kicker">02 · 身份信息</p><h2>你怎么称呼 TA？</h2><p className="hint">这会成为智能体在列表中的名字，之后也可以修改。</p><label>称呼<input value={name} onChange={e=>setName(e.target.value)} placeholder="例如：阿泽、妈妈、小雨"/></label><label>你们的关系（可选）<input value={relation} onChange={e=>setRelation(e.target.value)} placeholder="例如：朋友、家人、同事"/></label><button className="primary full" disabled={!name.trim()} onClick={()=>setStep(3)}>下一步：选择声音 →</button></div>}
      {step === 3 && <div className="card"><p className="kicker">03 · 声音（可选）</p><h2>要为 TA 添加声音吗？</h2><p className="hint">仅在本人明确同意后录制或上传。跳过后仍可正常进行文字对话。</p><div className="voice-options"><button className={voice ? "selected" : ""} onClick={()=>setVoice(true)}><b>◉</b><strong>录制一段声音</strong><small>建议 30 秒以上，环境安静</small></button><button className={voice ? "selected" : ""} onClick={()=>setVoice(true)}><b>↑</b><strong>上传音频文件</strong><small>支持 MP3、WAV、M4A</small></button></div><label className="consent"><input type="checkbox" checked={voice} onChange={e=>setVoice(e.target.checked)}/> 我确认已获得声音所有者的明确授权</label><div className="split"><button className="secondary" onClick={()=>{setVoice(false);setStep(4)}}>暂时跳过</button><button className="primary" disabled={!voice} onClick={()=>setStep(4)}>继续 →</button></div></div>}
      {step === 4 && <div className="card"><p className="kicker">04 · 对话模式</p><h2>选择回应方式</h2><p className="hint">之后可以随时切换。快速档适合日常聊天；专业档需要这台电脑保持在线。</p><div className="mode-options"><button className={modelMode === "fast" ? "selected" : ""} onClick={()=>setModelMode("fast")}><span className="mode-icon">⚡</span><strong>快速档</strong><small>DeepSeek V4 Flash</small><p>几秒内回应，参考聊天记录模仿语气，适合随时使用。</p><em>推荐日常使用</em></button><button className={modelMode === "pro" ? "selected" : ""} onClick={()=>setModelMode("pro")}><span className="mode-icon">◎</span><strong>专业档</strong><small>本机 WeClone</small><p>调用专属微调模型，还原度更高，但首次启动较慢。</p><em>电脑需保持在线</em></button></div><button className="primary full" onClick={()=>setStep(5)}>下一步：确认创建 →</button></div>}
      {step === 5 && <div className="card ready"><div className="ready-orb">{name?.[0] || "回"}</div><p className="kicker">05 · 准备完成</p><h2>{name} 的回声已准备好</h2><p className="hint">我们会从你提供的内容中提炼表达习惯。每次回应都会清楚标注为 AI 生成。</p><div className="summary"><span>对话样本<b>{log.length} 字</b></span><span>对话档位<b>{modelMode === "fast" ? "快速 · DeepSeek" : "专业 · WeClone"}</b></span><span>交流方式<b>{voice ? "文字 + 语音" : "文字"}</b></span></div><button className="primary full" onClick={finish}>完成并开始对话 →</button></div>}
    </section>}

    {view === "chat" && <section className="chat-shell"><aside><button className="back" onClick={()=>setView("home")}>← 所有智能体</button><div className={`agent-orb ${active.color}`}><span>{active.name[0]}</span></div><h2>{active.name}</h2><p>{active.relation}</p><span className="ai-label">{active.modelMode === "fast" ? "⚡ 快速档 · DeepSeek" : "◎ 专业档 · WeClone"}</span><button className="secondary" onClick={openCreate}>＋ 新建回声</button></aside><div className="conversation"><header><div><h3>{active.name}</h3><p>AI 生成内容 · {active.modelMode === "fast" ? "快速档" : "专业档"}</p></div><button>•••</button></header><div className="messages">{messages.map((m,i)=><div key={i} className={m.role === "user" ? "mine msg" : "theirs msg"}>{m.content}</div>)}{replying && <div className="theirs msg">正在回应…</div>}{chatError && <div className="chat-error">{chatError}</div>}</div><div className="composer"><button className="mic" aria-label="语音输入">⌁</button><textarea value={message} disabled={replying} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder={`和 ${active.name} 说点什么…`}/><button className="send" disabled={replying} onClick={send}>↑</button></div></div></section>}

    <footer><span>回声 ECHO</span><p>请尊重隐私与人格权，未经授权请勿克隆或传播他人声音。</p></footer>
  </main>;
}
