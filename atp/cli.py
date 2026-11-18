"""CLI entry: python -m atp.cli ..."""

from __future__ import annotations

import argparse
import json
import sys

from atp.capture import close_session, serve_ingest, start_session
from atp.config import load_platform_config
from atp.runner import repo_root, run_suite
from atp.store import load_json


def cmd_run(args: argparse.Namespace) -> int:
    config = load_platform_config()
    project = args.project or config.get("default_project", "example-service")
    run_dir = run_suite(project, args.suite, args.env, config, args.cases)
    summary = load_json(run_dir / "summary.json", {})
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary.get("status") == "passed" else 1


def cmd_runs_list(args: argparse.Namespace) -> int:
    index = load_json(repo_root() / "runs" / "index.json", {"runs": []})
    runs = index.get("runs") or []
    if args.status:
        runs = [r for r in runs if r.get("status") == args.status]
    if args.project:
        runs = [r for r in runs if r.get("project") == args.project]
    limit = args.limit
    for r in runs[:limit]:
        print(f"{r.get('started_at')}  {r.get('status'):8}  {r.get('project')}/{r.get('suite')}  {r.get('id')}")
    return 0


def cmd_capture_start(args: argparse.Namespace) -> int:
    session_dir = start_session(args.project, args.label or "")
    print(session_dir.relative_to(repo_root()))
    return 0


def cmd_capture_serve(args: argparse.Namespace) -> int:
    config = load_platform_config()
    cap = config.get("capture") or {}
    session_dir = repo_root() / "projects" / args.project / "captures" / args.session
    if not session_dir.is_dir():
        print(f"Unknown session: {args.session}", file=sys.stderr)
        return 1
    host = args.host or cap.get("ingest_host", "127.0.0.1")
    port = int(args.port or cap.get("ingest_port", 8765))
    redact = list(cap.get("redact_headers") or [])
    serve_ingest(session_dir, host, port, redact)
    return 0


def cmd_capture_close(args: argparse.Namespace) -> int:
    session_dir = repo_root() / "projects" / args.project / "captures" / args.session
    close_session(session_dir)
    print("closed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="atp", description="API test platform (file store, no SQLite)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Run a test suite")
    p_run.add_argument("-p", "--project", help="Project id under projects/")
    p_run.add_argument("-s", "--suite", default="smoke")
    p_run.add_argument("-e", "--env", default="dev")
    p_run.set_defaults(func=cmd_run)

    p_list = sub.add_parser("runs", help="List past runs from runs/index.json")
    p_list.add_argument("action", choices=["list"])
    p_list.add_argument("--status", choices=["passed", "failed", "error"])
    p_list.add_argument("--project")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.set_defaults(func=cmd_runs_list)

    p_cs = sub.add_parser("capture-start", help="Open a new capture session directory")
    p_cs.add_argument("-p", "--project", required=True)
    p_cs.add_argument("--label", default="")
    p_cs.set_defaults(func=cmd_capture_start)

    p_cserve = sub.add_parser("capture-serve", help="Start ingest HTTP server for a session")
    p_cserve.add_argument("-p", "--project", required=True)
    p_cserve.add_argument("session")
    p_cserve.add_argument("--host")
    p_cserve.add_argument("--port", type=int)
    p_cserve.set_defaults(func=cmd_capture_serve)

    p_cclose = sub.add_parser("capture-close", help="Mark session closed")
    p_cclose.add_argument("-p", "--project", required=True)
    p_cclose.add_argument("session")
    p_cclose.set_defaults(func=cmd_capture_close)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())