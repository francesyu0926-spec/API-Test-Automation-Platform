import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import { access as fsAccess } from "node:fs/promises";
import path from "node:path";

export type JmeterLogSink = (text: string) => void;

let activeChild: ChildProcessWithoutNullStreams | null = null;
let cancelRequested = false;

export type JmeterDetectResult = {
  found: boolean;
  jmeterHome?: string;
  jmeterBin?: string;
  error?: string;
};

export type RunJmeterOptions = {
  jmxPath: string;
  /** 输出目录；默认在 JMX 同级创建 run_时间戳 */
  outputDir?: string;
  jmeterHome?: string;
  /** 生成 HTML Dashboard（-e -o report） */
  generateReport?: boolean;
  /** 传入 jmeter.bat 的 JVM_ARGS，如 -Xmx2g */
  jvmArgs?: string;
};

export type RunJmeterResult = {
  ok: boolean;
  cancelled?: boolean;
  exitCode?: number | null;
  jmxPath: string;
  outputDir: string;
  jtlPath: string;
  reportDir?: string;
  logPath: string;
  stdout: string;
  stderr: string;
  error?: string;
};

function jmeterHomeFromEnv(): string | undefined {
  const home = process.env.JMETER_HOME?.trim();
  return home || undefined;
}

function jmeterBinPath(home: string): string {
  const base = path.join(home, "bin", process.platform === "win32" ? "jmeter.bat" : "jmeter");
  return base;
}

async function jmeterHomeValid(home: string): Promise<JmeterDetectResult> {
  const bin = jmeterBinPath(home);
  try {
    await fs.access(bin);
    return { found: true, jmeterHome: path.resolve(home), jmeterBin: bin };
  } catch {
    return { found: false, jmeterHome: home, error: `未找到可执行文件：${bin}` };
  }
}

async function discoverJmeterHomes(): Promise<string[]> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (home: string | undefined) => {
    const h = home?.trim();
    if (!h) return;
    const key = path.resolve(h).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(path.resolve(h));
  };

  push(jmeterHomeFromEnv());

  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const binName = process.platform === "win32" ? "jmeter.bat" : "jmeter";
  for (const dir of pathEnv.split(sep)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const inBin = path.join(trimmed, binName);
    try {
      await fsAccess(inBin);
      if (path.basename(trimmed).toLowerCase() === "bin") {
        push(path.dirname(trimmed));
      }
    } catch {
      /* not in this PATH entry */
    }
  }

  if (process.platform === "win32") {
    const scanRoots = ["C:\\Program Files", "C:\\Program Files (x86)", "C:\\"];
    for (const root of scanRoots) {
      let entries: { name: string; isDirectory(): boolean }[] = [];
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (!/apache[- ]?jmeter|jmeter-\d/i.test(ent.name)) continue;
        push(path.join(root, ent.name));
      }
    }
  }

  return ordered;
}

/** 在未指定目录时搜索 PATH 与常见安装路径 */
export async function autoDetectJmeter(): Promise<JmeterDetectResult> {
  const homes = await discoverJmeterHomes();
  for (const home of homes) {
    const res = await jmeterHomeValid(home);
    if (res.found) return res;
  }
  return { found: false, error: "未在 JMETER_HOME、PATH 或常见安装目录找到 JMeter" };
}

export async function detectJmeter(customHome?: string): Promise<JmeterDetectResult> {
  const trimmed = customHome?.trim();
  if (trimmed) {
    return jmeterHomeValid(trimmed);
  }
  const fromEnv = jmeterHomeFromEnv();
  if (fromEnv) {
    const res = await jmeterHomeValid(fromEnv);
    if (res.found) return res;
  }
  return autoDetectJmeter();
}

function killJmeterTree(userCancel: boolean): boolean {
  const child = activeChild;
  if (!child?.pid) return false;
  if (userCancel) cancelRequested = true;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

export function cancelJmeterRun(): { ok: boolean } {
  return { ok: killJmeterTree(true) };
}

const JMETER_FATAL_LINE =
  /Error in NonGUIDriver|An error occurred:|java\.lang\.(IllegalArgumentException|RuntimeException)/i;

function defaultOutputDir(jmxPath: string): string {
  const base = path.dirname(jmxPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(base, `run_${stamp}`);
}

/** Windows 上不能直接 spawn .bat，否则会抛出 spawn EINVAL */
function spawnJmeter(
  jmeterBin: string,
  args: string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", jmeterBin, ...args], {
      ...options,
    }) as ChildProcessWithoutNullStreams;
  }
  return spawn(jmeterBin, args, options) as ChildProcessWithoutNullStreams;
}

export async function runJmeterTest(opts: RunJmeterOptions, onLog?: JmeterLogSink): Promise<RunJmeterResult> {
  const emit = (text: string) => {
    if (text) onLog?.(text);
  };
  const jmxPath = path.resolve(opts.jmxPath);
  try {
    await fs.access(jmxPath);
  } catch {
    return {
      ok: false,
      jmxPath,
      outputDir: "",
      jtlPath: "",
      logPath: "",
      stdout: "",
      stderr: "",
      error: "JMX 文件不存在或不可读",
    };
  }

  const detect = await detectJmeter(opts.jmeterHome);
  if (!detect.found || !detect.jmeterBin) {
    return {
      ok: false,
      jmxPath,
      outputDir: "",
      jtlPath: "",
      logPath: "",
      stdout: "",
      stderr: "",
      error: detect.error ?? "未找到 JMeter",
    };
  }

  const outputDir = path.resolve(opts.outputDir?.trim() || defaultOutputDir(jmxPath));
  const jtlPath = path.join(outputDir, "results.jtl");
  const logPath = path.join(outputDir, "jmeter.log");
  const reportDir = path.join(outputDir, "report");

  await fs.mkdir(outputDir, { recursive: true });
  if (opts.generateReport !== false) {
    await fs.rm(reportDir, { recursive: true, force: true });
    await fs.mkdir(reportDir, { recursive: true });
  }

  try {
    await fs.unlink(jtlPath);
    emit(`已删除已有 results.jtl（JMeter 要求结果文件为空）\n`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      emit(`警告：无法清除 results.jtl：${String(err)}\n`);
    }
  }

  const args = ["-n", "-t", jmxPath, "-l", jtlPath, "-j", logPath];
  if (opts.generateReport !== false) {
    args.push("-e", "-o", reportDir);
  }

  cancelRequested = false;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const jvmArgs = opts.jvmArgs?.trim();

  emit(
    [
      "──────── JMeter 非 GUI 执行 ────────",
      `JMETER_HOME: ${detect.jmeterHome}`,
      ...(jvmArgs ? [`JVM_ARGS: ${jvmArgs}`] : []),
      `计划: ${jmxPath}`,
      `JTL: ${jtlPath}`,
      `日志: ${logPath}`,
      opts.generateReport !== false ? `报告: ${reportDir}` : "报告: 未生成",
      `命令: jmeter ${args.join(" ")}`,
      "",
    ].join("\n"),
  );

  let logFileOffset = 0;
  let tailTimer: ReturnType<typeof setInterval> | null = null;
  let abortScheduled = false;
  let abortReason: string | undefined;

  const maybeAbortOnFatal = (text: string) => {
    if (abortScheduled || cancelRequested) return;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || !JMETER_FATAL_LINE.test(trimmed)) continue;
      abortReason = trimmed;
      abortScheduled = true;
      emit("\n[自动停止] 检测到 JMeter 错误，正在终止进程…\n");
      killJmeterTree(false);
      break;
    }
  };

  const consumeProcessOutput = (text: string, store: string[]) => {
    store.push(text);
    emit(text);
    maybeAbortOnFatal(text);
  };

  const tailJmeterLogFile = async () => {
    try {
      const stat = await fs.stat(logPath);
      if (stat.size <= logFileOffset) return;
      const handle = await fs.open(logPath, "r");
      try {
        const len = stat.size - logFileOffset;
        const buf = Buffer.alloc(len);
        await handle.read(buf, 0, len, logFileOffset);
        logFileOffset = stat.size;
        const chunk = buf.toString("utf8");
        emit(chunk);
        maybeAbortOnFatal(chunk);
      } finally {
        await handle.close();
      }
    } catch {
      /* jmeter.log 尚未创建 */
    }
  };

  const stopTail = () => {
    if (tailTimer) {
      clearInterval(tailTimer);
      tailTimer = null;
    }
  };

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawnJmeter(detect.jmeterBin!, args, {
      cwd: outputDir,
      windowsHide: true,
      env: {
        ...process.env,
        JMETER_HOME: detect.jmeterHome,
        ...(jvmArgs ? { JVM_ARGS: jvmArgs } : {}),
      },
    });
    activeChild = child;

    tailTimer = setInterval(() => {
      void tailJmeterLogFile();
    }, 450);

    child.stdout.on("data", (c: Buffer) => consumeProcessOutput(c.toString("utf8"), stdoutChunks));
    child.stderr.on("data", (c: Buffer) => consumeProcessOutput(c.toString("utf8"), stderrChunks));
    child.on("error", (err) => {
      stopTail();
      activeChild = null;
      reject(err);
    });
    child.on("close", (code) => {
      stopTail();
      void tailJmeterLogFile().finally(() => {
        emit(
          code === 0
            ? "\n=== JMeter 执行完成 ===\n"
            : `\n=== JMeter 已结束（退出码 ${code ?? "?"}）===\n`,
        );
        activeChild = null;
        resolve(code);
      });
    });
  }).catch((e: Error) => {
    stopTail();
    activeChild = null;
    return Promise.reject(e);
  });

  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");
  const cancelled = cancelRequested;
  cancelRequested = false;
  const ok = !cancelled && exitCode === 0;

  let error: string | undefined;
  if (!ok) {
    if (cancelled) error = "已取消";
    else if (abortReason) error = abortReason;
    else {
      const combined = `${stderr}\n${stdout}`;
      const match = combined.match(/Error in NonGUIDriver[^\n]*|An error occurred:[^\n]*/i);
      error = match?.[0]?.trim() ?? `JMeter 异常结束（退出码 ${exitCode ?? "?"}）`;
    }
  }

  return {
    ok,
    cancelled,
    exitCode,
    jmxPath,
    outputDir,
    jtlPath,
    reportDir: opts.generateReport !== false ? reportDir : undefined,
    logPath,
    stdout,
    stderr,
    error,
  };
}