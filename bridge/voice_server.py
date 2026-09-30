import base64, hashlib, io, os, re, subprocess, sys, tempfile, threading
from pathlib import Path
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

SPARK_ROOT=Path("/home/pr/Spark-TTS"); sys.path.insert(0,str(SPARK_ROOT))
from cli.SparkTTS import SparkTTS
app=FastAPI(); voices=Path("/home/pr/.echo/voices"); voices.mkdir(parents=True,exist_ok=True); cache=Path("/home/pr/.echo/cache"); cache.mkdir(parents=True,exist_ok=True); model=None
model_lock=threading.Lock(); inference_lock=threading.Lock()
prompt_token_cache={}
class Reference(BaseModel): voiceId:str; audio:str; mime:str="audio/wav"; name:str="sample"
class Synthesize(BaseModel): voiceId:str; text:str
class Warm(BaseModel): voiceId:str
def safe_id(v): return re.sub(r"[^a-zA-Z0-9_-]","",v)[:64]
def get_model():
 global model
 if model is None:
  with model_lock:
   if model is None:
    requested=os.environ.get("ECHO_VOICE_DEVICE","cuda")
    device=torch.device("cuda:0" if requested=="cuda" and torch.cuda.is_available() else "cpu")
    if device.type=="cuda": torch.set_float32_matmul_precision("high")
    model=SparkTTS(SPARK_ROOT/"pretrained_models/Spark-TTS-0.5B",device)
    original_tokenize=model.audio_tokenizer.tokenize
    def cached_tokenize(prompt_path):
     path=Path(prompt_path); key=(str(path),path.stat().st_mtime_ns)
     if key not in prompt_token_cache:
      prompt_token_cache.clear()
      prompt_token_cache[key]=original_tokenize(prompt_path)
     return prompt_token_cache[key]
    model.audio_tokenizer.tokenize=cached_tokenize
 return model
@app.on_event("startup")
def preload_model(): threading.Thread(target=get_model,daemon=True).start()
@app.get("/health")
def health(): return {"ok":True,"modelLoaded":model is not None}
@app.post("/warm")
def warm(p:Warm):
 ref=voices/f"{safe_id(p.voiceId)}.wav"
 if not ref.exists(): raise HTTPException(404,"voice reference missing")
 engine=get_model()
 try: engine.audio_tokenizer.tokenize(str(ref))
 except Exception: pass
 return {"ok":True,"modelLoaded":True,"referenceReady":True}
@app.post("/reference")
def reference(p:Reference):
 vid=safe_id(p.voiceId)
 if not vid: raise HTTPException(400,"invalid voice id")
 try: raw=base64.b64decode(p.audio,validate=True)
 except Exception: raise HTTPException(400,"invalid audio")
 if len(raw)>25*1024*1024: raise HTTPException(413,"audio too large")
 with tempfile.NamedTemporaryFile(suffix=Path(p.name).suffix or ".audio",delete=False) as f: f.write(raw); source=f.name
 target=voices/f"{vid}.wav"
 try: subprocess.run(["ffmpeg","-y","-i",source,"-ac","1","-ar","16000",str(target)],check=True,capture_output=True)
 except Exception as exc: raise HTTPException(400,f"audio conversion failed: {exc}")
 finally: os.unlink(source)
 return {"ok":True,"voiceId":vid}
@app.post("/synthesize")
def synthesize(p:Synthesize):
 ref=voices/f"{safe_id(p.voiceId)}.wav"; text=p.text.strip()[:500]
 if not ref.exists(): raise HTTPException(404,"voice reference missing")
 if not text: raise HTTPException(400,"text required")
 key=hashlib.sha256(f"{p.voiceId}\0{text}".encode()).hexdigest(); cached=cache/f"{key}.wav"
 if cached.exists(): return {"audio":base64.b64encode(cached.read_bytes()).decode("ascii"),"cached":True}
 with inference_lock, torch.inference_mode(): wav=get_model().inference(text,ref)
 buf=io.BytesIO(); sf.write(buf,wav,16000,format="WAV"); data=buf.getvalue(); cached.write_bytes(data)
 return {"audio":base64.b64encode(data).decode("ascii"),"cached":False}
