from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from atp.store import repo_root


def load_platform_config() -> dict[str, Any]:
    path = repo_root() / "platform.config.yaml"
    if not path.is_file():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}