"""Atomic index updates and run directory layout."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def atomic_write_json(path: Path, data: Any, tmp_suffix: str = ".tmp") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + tmp_suffix)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, path)


def load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def new_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{uuid.uuid4().hex[:8]}"


def new_session_id() -> str:
    return new_run_id()


def month_key_from_iso(iso: str) -> str:
    return iso[:7]


def append_run_index(repo: Path, entry: dict[str, Any]) -> None:
    index_path = repo / "runs" / "index.json"
    index = load_json(index_path, {"version": 1, "updated_at": utc_now_iso(), "runs": []})
    index["runs"].insert(0, entry)
    index["updated_at"] = utc_now_iso()
    atomic_write_json(index_path, index)

    month = month_key_from_iso(entry["started_at"])
    month_path = repo / "runs" / "by-month" / f"{month}.json"
    month_doc = load_json(month_path, {"version": 1, "month": month, "runs": []})
    month_doc["runs"].insert(0, {
        "id": entry["id"],
        "status": entry["status"],
        "suite": entry["suite"],
        "started_at": entry["started_at"],
    })
    atomic_write_json(month_path, month_doc)


def append_capture_index(session_dir: Path, entry: dict[str, Any]) -> None:
    index_path = session_dir / "index.json"
    index = load_json(index_path, {"version": 1, "transactions": []})
    index["transactions"].append(entry)
    atomic_write_json(index_path, index)