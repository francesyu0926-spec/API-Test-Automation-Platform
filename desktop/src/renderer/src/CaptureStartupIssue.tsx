import type { CaptureStartupCheck, CaptureStartupActionId } from "../../shared/captureStartupTypes";

type Props = {
  issue: CaptureStartupCheck;
  busy: boolean;
  onAction: (actionId: CaptureStartupActionId) => void;
};

const CODE_LABEL: Record<CaptureStartupCheck["code"], string> = {
  ERR_NO_MITM: "依赖检查",
  ERR_NO_PYTHON: "依赖检查",
  WARN_PORT_USED: "端口检查",
  ERR_CERT_MISSING: "证书生成",
  ERR_CERT_UNTRUSTED: "证书信任",
  OK_READY: "正常就绪",
};

export default function CaptureStartupIssue({ issue, busy, onAction }: Props) {
  if (issue.code === "OK_READY") return null;
  const tone =
    issue.code === "WARN_PORT_USED"
      ? "capture-startup-issue--warn"
      : issue.code === "ERR_CERT_MISSING"
        ? "capture-startup-issue--info"
        : "capture-startup-issue--error";

  return (
    <div className={`capture-startup-issue ${tone}`} role="alert">
      <div className="capture-startup-issue__head">
        <span className="capture-startup-issue__stage">{CODE_LABEL[issue.code]}</span>
        <span className="capture-startup-issue__code">{issue.code}</span>
      </div>
      <p className="capture-startup-issue__msg">{issue.message}</p>
      {issue.actions.length ? (
        <div className="capture-startup-issue__actions">
          {issue.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="nav-btn nav-btn--compact"
              disabled={busy}
              onClick={() => onAction(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}