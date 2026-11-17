"""
mitmproxy addon: forward HTTP(S) flows to ATP ingest.

Usage (after desktop「启动 Ingest」):

  set ATP_INGEST_URL=http://127.0.0.1:8765/ingest
  mitmdump -s scripts/mitm_ingest_addon.py --listen-host 0.0.0.0 --listen-port 8888

Optional filter (comma-separated host suffixes, e.g. api.example.com,httpbin.org):

  set ATP_CAPTURE_HOSTS=api.mycompany.com

Install CA on browser/phone: open http://mitm.it while proxy is active.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from mitmproxy import ctx, http

INGEST_URL = os.environ.get("ATP_INGEST_URL", "http://127.0.0.1:8765/ingest")
HOST_FILTER = [h.strip().lower() for h in os.environ.get("ATP_CAPTURE_HOSTS", "").split(",") if h.strip()]
BODY_PREVIEW = int(os.environ.get("ATP_CAPTURE_BODY_MAX", "16384"))


def _host_allowed(url: str) -> bool:
    if not HOST_FILTER:
        return True
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    for pattern in HOST_FILTER:
        p = pattern.strip().lower()
        if not p:
            continue
        if host == p or host.endswith("." + p):
            return True
    return False


def _decode_body(content: bytes | None) -> Any:
    if not content:
        return None
    preview = content[:BODY_PREVIEW]
    try:
        text = preview.decode("utf-8")
    except UnicodeDecodeError:
        return {"_base64_note": "binary body omitted", "length": len(content)}
    if len(content) > BODY_PREVIEW:
        return text + "...(truncated)"
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _headers(h: http.Headers) -> dict[str, str]:
    return {k: v for k, v in h.items(multi=True) if isinstance(k, str) and isinstance(v, str)}


_ingest_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _post(payload: dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        INGEST_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _ingest_opener.open(req, timeout=15) as resp:
            if resp.status >= 300:
                ctx.log.warn(f"ingest HTTP {resp.status}")
    except urllib.error.URLError as e:
        ctx.log.warn(f"ingest failed ({INGEST_URL}): {e}")


class ATPIngestAddon:
    def response(self, flow: http.HTTPFlow) -> None:
        if flow.request.method == "CONNECT":
            return
        if not flow.response:
            return
        url = flow.request.pretty_url
        if not _host_allowed(url):
            return

        req_content = flow.request.get_content()
        resp_content = flow.response.get_content()
        payload = {
            "tags": ["mitmproxy"],
            "request": {
                "method": flow.request.method,
                "url": url,
                "headers": _headers(flow.request.headers),
                "body": _decode_body(req_content),
            },
            "response": {
                "status": flow.response.status_code,
                "headers": _headers(flow.response.headers),
                "body": _decode_body(resp_content),
                "duration_ms": (flow.response.timestamp_end - flow.request.timestamp_start) * 1000
                if flow.response.timestamp_end
                else None,
            },
        }
        _post(payload)


addons = [ATPIngestAddon()]