"""Capture session storage and minimal ingest server (stdlib HTTP)."""

from __future__ import annotations

import json
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from atp.config import load_platform_config
from atp.store import append_capture_index, atomic_write_json, load_json, new_session_id, repo_root, utc_now_iso


def redact_headers(headers: dict[str, str], names: list[str]) -> dict[str, str]:
    lower = {k.lower(): k for k in headers}
    out = dict(headers)
    for name in names:
        if name.lower() in lower:
            orig = lower[name.lower()]
            out[orig] = "[REDACTED]"
    return out


def start_session(project: str, label: str = "") -> Path:
    repo = repo_root()
    session_id = new_session_id()
    session_dir = repo / "projects" / project / "captures" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    session = {
        "id": session_id,
        "project": project,
        "label": label,
        "started_at": utc_now_iso(),
        "status": "open",
    }
    atomic_write_json(session_dir / "session.json", session)
    atomic_write_json(session_dir / "index.json", {"version": 1, "transactions": []})
    return session_dir


def _truncate_body(value: Any, max_bytes: int) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    text = value if isinstance(value, str) else str(value)
    if len(text.encode("utf-8")) <= max_bytes:
        return value if isinstance(value, str) else text
    cut = text.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")
    return cut + "...(truncated)"


def ingest_transaction(session_dir: Path, payload: dict[str, Any], redact_header_names: list[str]) -> str:
    config = load_platform_config()
    cap = config.get("capture") or {}
    max_body = int(cap.get("body_max_bytes") or 65536)

    tx_id = uuid.uuid4().hex[:12]
    req = dict(payload.get("request") or {})
    if "headers" in req:
        req["headers"] = redact_headers({str(k): str(v) for k, v in (req["headers"] or {}).items()}, redact_header_names)
    if "body" in req:
        req["body"] = _truncate_body(req.get("body"), max_body)

    resp = dict(payload.get("response") or {})
    if "body" in resp:
        resp["body"] = _truncate_body(resp.get("body"), max_body)

    tx = {
        "id": tx_id,
        "session_id": session_dir.name,
        "captured_at": utc_now_iso(),
        "request": req,
        "response": resp,
        "tags": payload.get("tags") or [],
    }
    atomic_write_json(session_dir / "tx" / f"{tx_id}.json", tx)
    method = str(req.get("method", ""))
    url = str(req.get("url", ""))
    path = urlparse(url).path if url else ""
    append_capture_index(
        session_dir,
        {
            "id": tx_id,
            "method": method,
            "path": path,
            "url": url,
            "captured_at": tx["captured_at"],
            "file": f"tx/{tx_id}.json",
        },
    )
    return tx_id


def close_session(session_dir: Path) -> None:
    session_path = session_dir / "session.json"
    session = load_json(session_path, {})
    session["status"] = "closed"
    session["finished_at"] = utc_now_iso()
    atomic_write_json(session_path, session)


class IngestHandler(BaseHTTPRequestHandler):
    session_dir: Path
    redact_headers: list[str]

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/ingest":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400, "invalid json")
            return
        tx_id = ingest_transaction(self.session_dir, payload, self.redact_headers)
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"id": tx_id}).encode("utf-8"))


def serve_ingest(session_dir: Path, host: str, port: int, redact_headers: list[str]) -> None:
    handler = type(
        "Handler",
        (IngestHandler,),
        {"session_dir": session_dir, "redact_headers": redact_headers},
    )
    server = HTTPServer((host, port), handler)
    print(f"Capture ingest http://{host}:{port}/ingest  session={session_dir.name}")
    server.serve_forever()