"""Simple {{var}} substitution for URLs and bodies."""

from __future__ import annotations

import re
from typing import Any

_VAR = re.compile(r"\{\{(\w+)\}\}")


def substitute(value: Any, variables: dict[str, str]) -> Any:
    if isinstance(value, str):

        def repl(m: re.Match[str]) -> str:
            key = m.group(1)
            if key not in variables:
                raise KeyError(f"Undefined variable: {key}")
            return variables[key]

        return _VAR.sub(repl, value)
    if isinstance(value, dict):
        return {k: substitute(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute(v, variables) for v in value]
    return value