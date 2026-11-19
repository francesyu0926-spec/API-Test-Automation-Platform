import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import { getRepoRoot, pythonExecutable } from "./repo";

function pythonProcessEnv(repoRoot: string): NodeJS.ProcessEnv {
  const root = path.resolve(repoRoot);
  const sep = path.delimiter;
  const prefix = process.env.PYTHONPATH?.trim()
    ? `${root}${sep}${process.env.PYTHONPATH}`
    : root;
  return { ...process.env, PYTHONUTF8: "1", PYTHONPATH: prefix };
}

/** Windows embeddable Python ignores PYTHONPATH when `python*._pth` is present — bootstrap repo root. */
function spawnArgsForRepoModules(repoRoot: string, args: string[]): string[] {
  if (args[0] === "-m" && args[1]?.startsWith("atp.")) {
    const moduleName = args[1];
    const cliArgv = [moduleName, ...args.slice(2)];
    const rootLit = JSON.stringify(path.resolve(repoRoot));
    const argvLit = JSON.stringify(cliArgv);
    const code = [
      "import runpy, sys",
      `sys.path.insert(0, ${rootLit})`,
      `sys.argv = ${argvLit}`,
      `runpy.run_module(${JSON.stringify(moduleName)}, run_name="__main__")`,
    ].join("\n");
    return ["-c", code];
  }
  return args;
}

export function runPython(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const root = getRepoRoot();
  const py = pythonExecutable(root);
  const spawnArgs = spawnArgsForRepoModules(root, args);
  return new Promise((resolvePromise) => {
    const child = spawn(py, spawnArgs, {
      cwd: root,
      env: pythonProcessEnv(root),
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
  const spawnArgs = spawnArgsForRepoModules(root, args);
  return spawn(py, spawnArgs, {
    cwd: root,
    env: pythonProcessEnv(root),
    stdio: "pipe",
    detached: false,
    windowsHide: true,
  });
}