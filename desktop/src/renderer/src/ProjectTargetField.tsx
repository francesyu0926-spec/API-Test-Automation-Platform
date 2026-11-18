import { useEffect, useState } from "react";

import CreateProjectDialog from "./CreateProjectDialog";
import AppCustomSelect from "./AppCustomSelect";

type ProjectRow = { id: string; name: string };

export function originFromUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function suggestBaseUrlFromUrls(urls: string[]): string | undefined {
  for (const u of urls) {
    const o = originFromUrl(u);
    if (o) return o;
  }
  return undefined;
}

type Props = {
  active: boolean;
  value: string;
  onChange: (projectId: string) => void;
  defaultProjectId?: string;
  suggestedBaseUrl?: string;
  disabled?: boolean;
  description?: string;
};

export default function ProjectTargetField({
  active,
  value,
  onChange,
  defaultProjectId,
  suggestedBaseUrl,
  disabled,
  description = "所选请求将写入该项目的 cases/*.yaml，可在「项目与用例」中编辑与执行。",
}: Props) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState("");

  const loadProjects = async (pickPreferred?: string) => {
    setLoading(true);
    try {
      const list = await window.atp.listProjects();
      const rows = list.map((p) => ({ id: p.id, name: p.name }));
      setProjects(rows);
      const preferred =
        pickPreferred && rows.some((p) => p.id === pickPreferred)
          ? pickPreferred
          : defaultProjectId && rows.some((p) => p.id === defaultProjectId)
            ? defaultProjectId
            : value && rows.some((p) => p.id === value)
              ? value
              : rows[0]?.id ?? "";
      if (preferred !== value) onChange(preferred);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    setFlash("");
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when dialog opens
  }, [active, defaultProjectId]);

  const selected = projects.find((p) => p.id === value);

  const submitCreate = (opts: { id: string; name: string; baseUrl: string }) => {
    void (async () => {
      setCreating(true);
      try {
        const res = await window.atp.createProject(opts);
        if (!res.ok || !res.projectId) {
          setFlash(res.error ?? "创建项目失败");
          return;
        }
        setCreateOpen(false);
        await loadProjects(res.projectId);
        const label = opts.name.trim() || res.projectId;
        setFlash(`已创建并选中「${label}」`);
      } finally {
        setCreating(false);
      }
    })();
  };

  return (
  <>
    <section className="project-target-panel" aria-labelledby="project-target-label">
      <div className="project-target-header">
        <span id="project-target-label" className="project-target-title">
          保存到项目
        </span>
        <button
          type="button"
          className="nav-btn nav-btn--compact project-target-new"
          disabled={disabled || loading || creating}
          onClick={() => setCreateOpen(true)}
        >
          新建项目
        </button>
      </div>
      {loading ? (
        <p className="hint project-target-loading">加载项目列表…</p>
      ) : projects.length ? (
        <div className="project-target-row">
          <select
            className="workbench-sidebar-select project-target-select"
            value={value}
            disabled={disabled || creating}
            onChange={(e) => onChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {selected ? (
            <span className="project-target-id" title={`目录 ID：${selected.id}`}>
              {selected.id}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="hint warn project-target-empty">尚无项目，请点击「新建项目」创建后再保存用例。</p>
      )}
      {flash ? <p className="hint project-target-flash">{flash}</p> : null}
      <p className="hint project-target-desc">{description}</p>
    </section>

    <CreateProjectDialog
      open={createOpen}
      nested
      suggestedBaseUrl={suggestedBaseUrl}
      onCancel={() => !creating && setCreateOpen(false)}
      onCreate={submitCreate}
    />
  </>
  );
}