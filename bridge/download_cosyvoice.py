from modelscope import snapshot_download

snapshot_download(
    "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
    local_dir="/home/pr/CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B",
)
