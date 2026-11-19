"""Execute YAML cases and write run artifacts to disk."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import httpx
import yaml

from atp.store import append_run_index, atomic_write_json, load_json, new_run_id, repo_root, utc_now_iso
from atp.vars import substitute


def load_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def merge_variables(env_path: Path, project: str) -> dict[str, str]:
    variables: dict[str, str] = {"project": project}
    local = env_path.with_name(env_path.stem + ".local.yaml")
    for p in (env_path, local):
        if p.is_file():
            doc = load_yaml(p)
            for k, v in (doc.get("variables") or {}).items():
                variables[str(k)] = str(v)
    return variables


def run_assertions(case: dict, resp: httpx.Response, elapsed_ms: float) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for rule in case.get("assertions") or []:
        t = rule.get("type")
        if t == "status":
            ok = resp.status_code == int(rule["equals"])
            results.append({"type": "status", "ok": ok, "expected": rule["equals"], "actual": resp.status_code})
        elif t == "duration_ms":
            ok = elapsed_ms <= float(rule["max"])
            results.append({"type": "duration_ms", "ok": ok, "max": rule["max"], "actual": elapsed_ms})
        elif t == "body_contains":
            ok = rule.get("text", "") in resp.text
            results.append({"type": "body_contains", "ok": ok, "text": rule.get("text", "")})
        else:
            results.append({"type": t, "ok": False, "error": "unsupported assertion"})
    return results


def _error_step(
    case_path: Path,
    case: dict[str, Any] | None,
    message: str,
    *,
    partial_request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started = utc_now_iso()
    name = (case or {}).get("name") or case_path.stem
    req = partial_request or {}
    return {
        "case": name,
        "started_at": started,
        "finished_at": utc_now_iso(),
        "request": req,
        "response": {"status": None, "headers": {}, "body_preview": message[:4096]},
        "duration_ms": 0,
        "assertions": [{"type": "error", "ok": False, "error": message}],
        "status": "failed",
        "error": message,
    }


def execute_case(case_path: Path, variables: dict[str, str], timeout: float, verify: bool) -> dict[str, Any]:
    case: dict[str, Any] | None = None
    try:
        case = load_yaml(case_path)
        req = substitute(case["request"], variables)
        method = req["method"].upper()
        url = req["url"]
        headers = req.get("headers") or {}
        body = req.get("body")
    except KeyError as exc:
        hint = "请在「项目与用例」对应环境的 variables / .local.yaml 中补全变量。"
        return _error_step(case_path, case, f"环境变量未定义: {exc}。{hint}")
    except Exception as exc:
        return _error_step(case_path, case, f"用例无法执行: {exc}")

    started = utc_now_iso()
    t0 = time.perf_counter()
    partial = {"method": method, "url": url, "headers": headers}
    try:
        with httpx.Client(timeout=timeout, verify=verify) as client:
            response = client.request(
                method,
                url,
                headers=headers,
                json=body if isinstance(body, dict) else None,
                content=body if isinstance(body, str) else None,
            )
    except httpx.TimeoutException:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        msg = f"请求超时（>{timeout}s）：{method} {url}"
        step = _error_step(case_path, case, msg, partial_request=partial)
        step["duration_ms"] = round(elapsed_ms, 2)
        return step
    except httpx.RequestError as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        hint = ""
        if "api.example.com" in str(url):
            hint = " 当前 URL 可能仍指向默认 base_url，请在 dev 环境或 dev.local.yaml 中设置真实 base_url。"
        msg = f"网络请求失败：{exc!s}{hint}"
        step = _error_step(case_path, case, msg, partial_request=partial)
        step["duration_ms"] = round(elapsed_ms, 2)
        return step
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        step = _error_step(case_path, case, f"请求异常：{exc}", partial_request=partial)
        step["duration_ms"] = round(elapsed_ms, 2)
        return step

    elapsed_ms = (time.perf_counter() - t0) * 1000

    assertions = run_assertions(case, response, elapsed_ms)
    passed = all(a.get("ok") for a in assertions)

    return {
        "case": case.get("name", case_path.stem),
        "started_at": started,
        "finished_at": utc_now_iso(),
        "request": {"method": method, "url": url, "headers": headers},
        "response": {
            "status": response.status_code,
            "headers": dict(response.headers),
            "body_preview": response.text[:4096],
        },
        "duration_ms": round(elapsed_ms, 2),
        "assertions": assertions,
        "status": "passed" if passed else "failed",
    }


def run_suite(
    project: str,
    suite_name: str,
    env_name: str,
    config: dict[str, Any],
    cases: list[str] | None = None,
) -> Path:
    repo = repo_root()
    project_dir = repo / "projects" / project
    suite_path = project_dir / "suites" / f"{suite_name}.yaml"
    env_path = project_dir / "environments" / f"{env_name}.yaml"

    suite = load_yaml(suite_path)
    variables = merge_variables(env_path, project)
    run_cfg = config.get("run") or {}
    timeout = float(run_cfg.get("step_timeout_seconds", 30))
    verify = bool(run_cfg.get("http_verify_ssl", True))

    run_id = new_run_id()
    run_dir = repo / "runs" / run_id
    steps_dir = run_dir / "steps"
    steps_dir.mkdir(parents=True, exist_ok=True)

    started_at = utc_now_iso()
    step_results: list[dict[str, Any]] = []

    suite_cases = list(suite.get("cases") or [])
    if cases:
        case_names = [c for c in cases if c in suite_cases or (project_dir / "cases" / f"{c}.yaml").is_file()]
        if not case_names:
            case_names = list(cases)
    else:
        case_names = suite_cases

    for i, case_name in enumerate(case_names, start=1):
        case_path = project_dir / "cases" / f"{case_name}.yaml"
        if not case_path.is_file():
            step = _error_step(case_path, None, f"用例文件不存在：{case_path.relative_to(repo)}")
        else:
            step = execute_case(case_path, variables, timeout, verify)
        step_results.append(step)
        atomic_write_json(steps_dir / f"{i:04d}.json", step)

    failed = sum(1 for s in step_results if s["status"] != "passed")
    status = "passed" if failed == 0 else "failed"

    summary = {
        "id": run_id,
        "project": project,
        "suite": suite_name,
        "environment": env_name,
        "status": status,
        "started_at": started_at,
        "finished_at": utc_now_iso(),
        "stats": {"total": len(step_results), "passed": len(step_results) - failed, "failed": failed},
    }
    atomic_write_json(run_dir / "summary.json", summary)

    append_run_index(
        repo,
        {
            "id": run_id,
            "project": project,
            "suite": suite_name,
            "environment": env_name,
            "status": status,
            "started_at": started_at,
            "dir": f"runs/{run_id}",
        },
    )
    return run_dir