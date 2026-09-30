"""Run one Echo training job and make WeClone's optional vLLM import safe."""

import subprocess
import sys
from pathlib import Path


WECLONE_ROOT = Path("/home/pr/WeClone")
CLI = WECLONE_ROOT / ".venv/bin/weclone-cli"
OFFLINE_INFER = WECLONE_ROOT / "weclone/core/inference/offline_infer.py"


def ensure_optional_vllm() -> None:
    source = OFFLINE_INFER.read_text(encoding="utf-8")
    marker = "# Echo compatibility: vLLM is optional for SFT"
    if marker in source:
        return
    imports = """from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest
from vllm.outputs import RequestOutput
from vllm.sampling_params import GuidedDecodingParams"""
    replacement = """# Echo compatibility: vLLM is optional for SFT
try:
    from vllm import LLM, SamplingParams
    from vllm.lora.request import LoRARequest
    from vllm.outputs import RequestOutput
    from vllm.sampling_params import GuidedDecodingParams
except ModuleNotFoundError:
    LLM = SamplingParams = LoRARequest = GuidedDecodingParams = None

    class RequestOutput:
        pass"""
    if imports in source:
        OFFLINE_INFER.write_text(source.replace(imports, replacement), encoding="utf-8")


def main() -> None:
    settings_path = Path(sys.argv[1]).resolve()
    ensure_optional_vllm()
    result = subprocess.run(
        [str(CLI), "--config-path", str(settings_path), "train-sft"],
        cwd=WECLONE_ROOT,
        check=False,
    )
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
