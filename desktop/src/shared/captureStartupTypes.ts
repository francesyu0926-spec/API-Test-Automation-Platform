export type CaptureStartupCode =
  | "OK_READY"
  | "ERR_NO_MITM"
  | "ERR_NO_PYTHON"
  | "WARN_PORT_USED"
  | "ERR_CERT_MISSING"
  | "ERR_CERT_UNTRUSTED";

export type CaptureStartupActionId =
  | "install_deps"
  | "use_new_port"
  | "install_cert"
  | "export_cert"
  | "open_repo";

export type CaptureStartupCheck = {
  ok: boolean;
  code: CaptureStartupCode;
  stage: 1 | 2 | 3 | 4;
  message: string;
  listenPort: number;
  suggestedPort?: number;
  occupierProcess?: string;
  actions: Array<{ id: CaptureStartupActionId; label: string }>;
};