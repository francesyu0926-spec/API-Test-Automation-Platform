/** JMeter 控制台单行样式 */
export function jmeterLogLineClass(line: string): string {
  const raw = line.trim();
  if (!raw) return "jmeter-log-line";
  const upper = raw.toUpperCase();
  if (/\b(ERROR|FATAL)\b/.test(upper) || /Error in NonGUIDriver|An error occurred:/i.test(raw)) {
    return "jmeter-log-line jmeter-log-line--error";
  }
  if (/\bWARN(?:ING)?\b/.test(upper)) {
    return "jmeter-log-line jmeter-log-line--warn";
  }
  return "jmeter-log-line";
}

export function suggestJmeterOutputDir(jmxFile: string): string {
  const normalized = jmxFile.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  const dir = idx >= 0 ? jmxFile.slice(0, idx) : jmxFile;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sep = jmxFile.includes("\\") ? "\\" : "/";
  return `${dir}${sep}run_${stamp}`;
}

export function jmeterVersionLabel(home: string): string | null {
  const m = home.match(/jmeter[-_]?(\d+\.\d+(?:\.\d+)?)?/i);
  return m?.[1] ?? null;
}