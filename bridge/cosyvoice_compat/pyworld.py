"""Inference-only compatibility shim for CosyVoice's training-only import."""


def _training_only(*_args, **_kwargs):
    raise RuntimeError("pyworld pitch extraction is unavailable in inference-only mode")


harvest = _training_only
dio = _training_only
stonemask = _training_only
