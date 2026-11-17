import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { getRepoRoot, pythonExecutable } from "./repo";

export function runPython(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const root = getRepoRoot();
  const py = pythonExecutable(root);
  return new Promise((resolvePromise) => {
    const child = spawn(py, args, {
      cwd: root,
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function spawnPythonDetached(args: string[]): ChildProcessWithoutNullStreams {
  const root = getRepoRoot();
  const py = pythonExecutable(root);
  return spawn(py, args, {
    cwd: root,
    env: { ...process.env, PYTHONUTF8: "1" },
    stdio: "pipe",
    detached: false,
    windowsHide: true,
  });
}