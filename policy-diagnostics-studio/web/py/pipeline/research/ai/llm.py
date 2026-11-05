"""Browser replacement for pipeline/research/ai/llm.py.

The model (Qwen3-4B, q4f16, WebLLM on WebGPU) runs in JavaScript. Python cannot wait for it synchronously, so a call
whose answer is not yet known raises NeedResource with the full request; the JavaScript runtime runs the model with the
same JSON schema (grammar-constrained decoding), stores the answer under the request's hash and replays the
deterministic Python call. The interface (complete_json, status, MODEL, LLMError) is the same as the local module.
"""
from __future__ import annotations

import hashlib
import json

MODEL = {"name": "Qwen3-4B (q4f16_1, WebLLM)", "publisher": "Qwen (Alibaba Cloud)", "licence": "Apache-2.0",
         "source": "https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC", "runtime": "WebLLM 0.2.87 on WebGPU, in this browser",
         "ready_label": "Model ready", "where": "running in this browser; your question is not sent anywhere"}
CTX = 8192
CACHE: dict[str, dict] = {}
STATE = {"available": False, "reason": "The language model has not been downloaded in this browser."}


class NeedResource(BaseException):
    """Raised to ask the JavaScript runtime for data files or a model answer; the call is then replayed.
    A BaseException so that the engine's per-step `except Exception` handlers cannot swallow it."""

    def __init__(self, need: dict):
        super().__init__(need.get("kind"))
        self.need = need


class LLMError(RuntimeError):
    pass


def status() -> dict:
    return {"available": bool(STATE["available"]), "model": MODEL, "endpoint": "WebLLM (in this browser)", "context_tokens": CTX,
            **({} if STATE["available"] else {"reason": STATE["reason"]})}


def start(wait: float = 0) -> dict:
    return status()


def stop():
    pass


def request_key(system: str, user: str, schema: dict, max_tokens: int, temperature: float) -> str:
    return hashlib.sha256(json.dumps([system, user, schema, max_tokens, temperature], sort_keys=True).encode()).hexdigest()


def complete_json(system: str, user: str, schema: dict, max_tokens: int = 700, temperature: float = 0.0) -> tuple[dict, dict]:
    if not STATE["available"]:
        raise LLMError(STATE["reason"])
    key = request_key(system, user, schema, max_tokens, temperature)
    if key in CACHE:
        r = CACHE[key]
        if "error" in r:
            raise LLMError(r["error"])
        return json.loads(json.dumps(r["data"])), dict(r.get("usage", {}))
    raise NeedResource({"kind": "llm", "key": key, "system": system, "user": user, "schema": schema,
                        "max_tokens": max_tokens, "temperature": temperature})
