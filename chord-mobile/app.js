import { CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { BUNDLED_DEEPSEEK_KEY, BUNDLED_ECHO_TOKEN } from "./private-config.js";

const Speech = registerPlugin("EchoSpeech");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api = "https://arichm.dpdns.org";
const headers = { "Content-Type":"application/json", "X-Echo-Token":BUNDLED_ECHO_TOKEN };
const state = { page:"chats", agents:[], active:null, turns:[], creating:null, busy:false, call:false, callText:"", player:null };

async function boot(){
  const stored = await Preferences.get({key:"chord_agents"});
  state.agents = stored.value ? JSON.parse(stored.value) : [];
  render();
}
const persist = () => Preferences.set({key:"chord_agents",value:JSON.stringify(state.agents)});

function chrome(body, title="弦音"){
  return `<main class="screen"><header class="top"><button class="menu">☰</button><h1>${esc(title)}</h1><button data-new class="search">✎</button></header>${body}<nav><button data-page="chats" class="${state.page==='chats'?'on':''}"><i>◉</i>聊天</button><button data-page="contacts" class="${state.page==='contacts'?'on':''}"><i>♙</i>智能体</button><button data-page="settings" class="${state.page==='settings'?'on':''}"><i>⚙</i>设置</button></nav></main>`;
}
function chats(){
  const rows=state.agents.map((a,i)=>`<button class="thread" data-open="${i}"><i>${esc(a.name[0])}</i><span><b>${esc(a.name)}</b><small>${esc(a.turns?.at(-1)?.content||a.relation||"新的对话")}</small></span><time>${a.turns?.length?"刚刚":"新建"}</time></button>`).join("");
  return chrome(`<section class="stories"><button data-new><i>＋</i><span>新建</span></button>${state.agents.slice(0,6).map((a,i)=>`<button data-open="${i}"><i>${esc(a.name[0])}</i><span>${esc(a.name)}</span></button>`).join("")}</section><div class="threads">${rows||`<div class="empty"><div>✦</div><h2>开始第一段对话</h2><p>创建一个智能体，它会出现在你的会话列表中。</p><button data-new>创建智能体</button></div>`}</div><button class="fab" data-new>✎</button>`);
}
function contacts(){ return chrome(`<div class="contact-list">${state.agents.map((a,i)=>`<button data-open="${i}"><i>${esc(a.name[0])}</i><span><b>${esc(a.name)}</b><small>${esc(a.relation||"智能体")} · ${a.mode==='pro'?'专业':'快速'}</small></span><em>›</em></button>`).join("")||"<p>还没有智能体</p>"}</div>`,"智能体"); }
function settings(){ return chrome(`<section class="settings"><div><i>☁</i><span><b>服务器</b><small>${api}</small></span><em>在线</em></div><div><i>◌</i><span><b>隐私与数据</b><small>聊天记录保存在本机</small></span><em>›</em></div><div><i>?</i><span><b>关于弦音</b><small>Chord 1.0</small></span><em>›</em></div></section>`,"设置"); }
function creator(){
  const d=state.creating;
  let content=d.step===1?`<h2>创建智能体</h2><p>粘贴你们的聊天记录，弦音会学习对方的表达方式。</p><textarea id="log" placeholder="姓名：消息内容">${esc(d.log)}</textarea><button class="next" data-next ${d.log.length<20?'disabled':''}>继续</button>`:
  d.step===2?`<h2>TA 是谁？</h2><p>这些信息只用于组织对话。</p><label>称呼<input id="name" value="${esc(d.name)}" placeholder="例如：阿泽"></label><label>关系<input id="relation" value="${esc(d.relation)}" placeholder="朋友、家人、同事"></label><button class="next" data-next ${!d.name?'disabled':''}>继续</button>`:
  `<h2>选择模式</h2><p>${esc(d.status||'创建后仍可在资料页查看状态。')}</p><div class="mode"><button data-mode="fast" class="${d.mode==='fast'?'on':''}" ${d.working?'disabled':''}>⚡<b>快速</b><small>DeepSeek 在线响应</small></button><button data-mode="pro" class="${d.mode==='pro'?'on':''}" ${d.working?'disabled':''}>◆<b>专业</b><small>WeClone 私人模型</small></button></div><label class="upload">${d.voiceReady?'✓ 声音已添加':'添加声音（可选）'}<input id="voice" type="file" accept="audio/*" capture="user" ${d.working?'disabled':''}></label><button class="next" data-create-agent ${d.working?'disabled':''}>${d.working?'正在准备智能体…':'完成创建'}</button>`;
  return `<main class="compose"><header><button data-cancel>‹</button><span>步骤 ${d.step}/3</span><i></i></header><div class="compose-card">${content}</div></main>`;
}
function chat(){
  const a=state.active; const msgs=state.turns.map(t=>`<div class="bubble ${t.role}">${esc(t.content)}</div>`).join("");
  return `<main class="conversation"><header><button data-back>‹</button><i>${esc(a.name[0])}</i><span><b>${esc(a.name)}</b><small>AI 模拟 · ${a.mode==='pro'?'专业':'快速'}</small></span><button data-call>☎</button><button>⋮</button></header><section class="messages">${msgs}${state.busy?'<div class="typing"><i></i><i></i><i></i></div>':''}</section><form id="send"><button type="button">☺</button><textarea id="text" placeholder="消息"></textarea><button>➤</button></form>${state.call?callView():''}</main>`;
}
function callView(){ return `<section class="call"><button data-hang>×</button><div class="halo"><i>${esc(state.active.name[0])}</i></div><h2>${esc(state.active.name)}</h2><p>${esc(state.callText||"正在连接…")}</p><div class="spectrum">${Array.from({length:24},(_,i)=>`<i style="--n:${i}"></i>`).join('')}</div><button class="hang" data-hang>☎</button></section>`; }
function render(){ $('#app').innerHTML=state.page==='create'?creator():state.page==='chat'?chat():state.page==='contacts'?contacts():state.page==='settings'?settings():chats(); bind(); requestAnimationFrame(()=>{const m=$('.messages');if(m)m.scrollTop=m.scrollHeight}); }

function bind(){
  document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;render()});
  document.querySelectorAll('[data-new]').forEach(b=>b.onclick=()=>{state.creating={step:1,log:"",name:"",relation:"",mode:"fast",voiceReady:false,id:String(Date.now())};state.page='create';render()});
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openAgent(state.agents[+b.dataset.open]));
  $('[data-cancel]')?.addEventListener('click',()=>{state.page='chats';render()});
  $('#log')?.addEventListener('input',e=>{state.creating.log=e.target.value;e.target.closest('.compose-card').querySelector('[data-next]').disabled=e.target.value.length<20});
  $('#name')?.addEventListener('input',e=>{state.creating.name=e.target.value;e.target.closest('.compose-card').querySelector('[data-next]').disabled=!e.target.value.trim()});
  $('#relation')?.addEventListener('input',e=>state.creating.relation=e.target.value);
  $('[data-next]')?.addEventListener('click',()=>{state.creating.step++;render()});
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.creating.mode=b.dataset.mode;render()});
  $('#voice')?.addEventListener('change',uploadVoice);
  $('[data-create-agent]')?.addEventListener('click',createAgent);
  $('[data-back]')?.addEventListener('click',()=>{state.page='chats';render()});
  $('#send')?.addEventListener('submit',send);
  $('[data-call]')?.addEventListener('click',startCall);
  document.querySelectorAll('[data-hang]').forEach(b=>b.onclick=endCall);
}
function openAgent(a){state.active=a;state.turns=a.turns?.length?a.turns:[{role:'assistant',content:`你好，我是${a.name}。`}];state.page='chat';render()}
async function createAgent(){
  const d=state.creating; d.working=true; d.status=d.mode==='pro'?'正在提交私人模型训练…':'正在创建…'; render();
  try{
    if(d.mode==='pro'){
      const start=await CapacitorHttp.post({url:`${api}/professional/train`,headers,data:{agentId:d.id,name:d.name,relation:d.relation,chatLog:d.log},connectTimeout:10000,readTimeout:20000});
      if(start.status!==200)throw new Error(start.data?.detail||'训练未能开始');
      while(true){await new Promise(ok=>setTimeout(ok,2500));const check=await CapacitorHttp.get({url:`${api}/professional/train/${d.id}`,headers});const info=check.data||{};d.status=info.phase||'正在训练表达风格';render();if(info.status==='ready')break;if(info.status==='failed')throw new Error(info.error||'训练失败')}
    }
    const a={...d,working:false,status:'',agentId:d.id,voiceId:d.id,turns:[]};state.agents.unshift(a);await persist();openAgent(a);
  }catch(error){d.working=false;d.status=error.message||'创建失败，请稍后重试';render()}
}
async function uploadVoice(e){const f=e.target.files?.[0];if(!f)return;const audio=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f)});const res=await CapacitorHttp.post({url:`${api}/voice/reference`,headers,data:{voiceId:state.creating.id,mime:f.type,name:f.name,audio}});state.creating.voiceReady=res.status===200;render()}
async function send(e){e.preventDefault();const text=$('#text').value.trim();if(!text||state.busy)return;state.turns.push({role:'user',content:text});state.busy=true;render();await reply()}
async function reply(){try{const a=state.active;let text;if(a.mode==='pro'){const r=await CapacitorHttp.post({url:`${api}/chat`,headers,data:{agentId:a.agentId,agentName:a.name,relation:a.relation,chatLog:a.log,messages:state.turns.slice(-20)}});text=r.data.reply}else{const r=await CapacitorHttp.post({url:'https://api.deepseek.com/chat/completions',headers:{'Content-Type':'application/json',Authorization:`Bearer ${BUNDLED_DEEPSEEK_KEY}`},data:{model:'deepseek-v4-flash',max_tokens:120,messages:[{role:'system',content:`模仿${a.name}的聊天语气，简短自然，不得冒充真人。参考：${a.log.slice(0,5000)}`},...state.turns.slice(-20)]}});text=r.data.choices?.[0]?.message?.content}state.turns.push({role:'assistant',content:String(text||'').trim()});a.turns=state.turns;await persist();state.busy=false;render();if(state.call){state.callText='对方正在说话';render();await speak(text);if(state.call)setTimeout(listen,400)}}catch{state.busy=false;state.callText='连接失败';render()}}
async function speak(text){if(!state.active.voiceReady)return;const r=await CapacitorHttp.post({url:`${api}/voice/synthesize`,headers,data:{voiceId:state.active.voiceId,text:String(text).slice(0,80)}});if(r.data?.audio)await new Promise((ok,no)=>{const p=new Audio(`data:audio/wav;base64,${r.data.audio}`);state.player=p;p.onended=ok;p.onerror=no;p.play().catch(no)})}
async function startCall(){state.call=true;state.callText='请说话…';render();setTimeout(listen,500)}
async function listen(){if(!state.call)return;state.callText='正在聆听';render();try{const r=await Speech.listen({language:'zh-CN'});if(!state.call)return;state.turns.push({role:'user',content:r.text});state.busy=true;state.callText='正在思考';render();await reply()}catch{if(state.call)setTimeout(listen,800)}}
async function endCall(){state.call=false;if(state.player){state.player.pause();state.player=null}try{await Speech.stop()}catch{}render()}
boot();
