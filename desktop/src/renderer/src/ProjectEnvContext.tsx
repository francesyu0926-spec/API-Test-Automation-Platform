import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import CreateEnvDialog from "./CreateEnvDialog";
import EnvContextBar from "./EnvContextBar";
import EnvVariablesDialog, { collectTemplateVarNames } from "./EnvVariablesDialog";

export type OpenEnvVariablesOpts = {
  sampler?: WorkbenchDraft;
  variableNames?: string[];
  onSaved?: () => void;
};

export type ProjectEnvContextValue = {
  projectId: string;
  envName: string;
  environments: string[];
  variables: Record<string, string>;
  variablesLoading: boolean;
  setEnvName: (name: string) => void;
  refreshEnvironments: () => Promise<void>;
  refreshVariables: () => Promise<void>;
  openEnvVariables: (opts?: OpenEnvVariablesOpts) => void;
  openCreateEnv: (suggestedBaseUrl?: string) => void;
};

const ProjectEnvContext = createContext<ProjectEnvContextValue | null>(null);

export function useProjectEnv(): ProjectEnvContextValue {
  const ctx = useContext(ProjectEnvContext);
  if (!ctx) throw new Error("useProjectEnv requires ProjectEnvProvider");
  return ctx;
}

export function useProjectEnvOptional(): ProjectEnvContextValue | null {
  return useContext(ProjectEnvContext);
}

type ProviderProps = {
  projectId: string;
  children: ReactNode;
};

export function ProjectEnvProvider({ projectId, children }: ProviderProps) {
  const [envName, setEnvNameState] = useState("dev");
  const [environments, setEnvironments] = useState<string[]>(["dev"]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [variablesLoading, setVariablesLoading] = useState(false);
  const [envVarsOpen, setEnvVarsOpen] = useState(false);
  const [createEnvOpen, setCreateEnvOpen] = useState(false);
  const [createEnvSuggestedBaseUrl, setCreateEnvSuggestedBaseUrl] = useState<string | undefined>();
  const [varsDialog, setVarsDialog] = useState<{
    sampler?: WorkbenchDraft;
    variableNames?: string[];
  }>({});
  const onVarsSavedRef = useRef<(() => void) | undefined>(undefined);

  const setEnvName = useCallback((name: string) => {
    setEnvNameState(name);
  }, []);

  const refreshEnvironments = useCallback(async () => {
    if (!projectId) {
      setEnvironments(["dev"]);
      return;
    }
    const assets = await window.atp.listProjectAssets(projectId);
    const envs = assets.environments.length ? assets.environments : ["dev"];
    setEnvironments(envs);
    setEnvNameState((prev) => (envs.includes(prev) ? prev : envs[0]));
  }, [projectId]);

  const refreshVariables = useCallback(async () => {
    if (!projectId || !envName) return;
    setVariablesLoading(true);
    try {
      const vars = await window.atp.getProjectVariables(projectId, envName);
      setVariables(vars);
    } finally {
      setVariablesLoading(false);
    }
  }, [projectId, envName]);

  useEffect(() => {
    void refreshEnvironments();
  }, [refreshEnvironments]);

  useEffect(() => {
    void refreshVariables();
  }, [refreshVariables]);

  const openEnvVariables = useCallback((opts?: OpenEnvVariablesOpts) => {
    onVarsSavedRef.current = opts?.onSaved;
    setVarsDialog({ sampler: opts?.sampler, variableNames: opts?.variableNames });
    setEnvVarsOpen(true);
  }, []);

  const openCreateEnv = useCallback((suggestedBaseUrl?: string) => {
    setCreateEnvSuggestedBaseUrl(suggestedBaseUrl);
    setCreateEnvOpen(true);
  }, []);

  const value: ProjectEnvContextValue = {
    projectId,
    envName,
    environments,
    variables,
    variablesLoading,
    setEnvName,
    refreshEnvironments,
    refreshVariables,
    openEnvVariables,
    openCreateEnv,
  };

  const explicitVarNamesKey = varsDialog.variableNames
    ? [...new Set(varsDialog.variableNames.map((n) => n.trim()).filter(Boolean))].sort().join("\u0001")
    : "";
  const samplerVarNamesKey = varsDialog.sampler
    ? collectTemplateVarNames(varsDialog.sampler).sort().join("\u0001")
    : "";
  const varNames = useMemo(() => {
    if (varsDialog.variableNames?.length) return varsDialog.variableNames;
    if (!varsDialog.sampler) return [] as string[];
    return collectTemplateVarNames(varsDialog.sampler);
  }, [explicitVarNamesKey, samplerVarNamesKey, varsDialog.variableNames, varsDialog.sampler]);

  return (
    <ProjectEnvContext.Provider value={value}>
      {children}
      {projectId ? (
        <>
          <CreateEnvDialog
            open={createEnvOpen}
            copyFrom={envName}
            suggestedBaseUrl={createEnvSuggestedBaseUrl ?? (variables.base_url?.trim() || undefined)}
            onCancel={() => setCreateEnvOpen(false)}
            onCreate={(opts) => {
              void (async () => {
                const res = await window.atp.createProjectEnvironment(projectId, opts.envName, {
                  copyFrom: opts.copyFrom,
                  baseUrl: opts.baseUrl,
                });
                if (!res.ok || !res.envName) return;
                setCreateEnvOpen(false);
                await refreshEnvironments();
                setEnvNameState(res.envName);
              })();
            }}
          />
          <EnvVariablesDialog
            open={envVarsOpen}
            project={projectId}
            envName={envName}
            sampler={varsDialog.sampler}
            variableNames={varNames}
            onCancel={() => {
              onVarsSavedRef.current = undefined;
              setEnvVarsOpen(false);
            }}
            onSaved={() => {
              setEnvVarsOpen(false);
              void refreshVariables().then(() => {
                onVarsSavedRef.current?.();
                onVarsSavedRef.current = undefined;
              });
            }}
          />
        </>
      ) : null}
    </ProjectEnvContext.Provider>
  );
}

/** 左侧栏全局环境条（dev + ⚙） */
export function GlobalEnvSidebar() {
  const ctx = useProjectEnvOptional();
  if (!ctx?.projectId) return null;

  return (
    <div className="sidebar-global-env" aria-label="运行环境">
      <span className="sidebar-global-env-label">环境</span>
      <EnvContextBar
        envName={ctx.envName}
        environments={ctx.environments}
        disabled={!ctx.projectId}
        onEnvChange={ctx.setEnvName}
        onCreateEnv={() => ctx.openCreateEnv()}
        onOpenVars={() => ctx.openEnvVariables()}
      />
    </div>
  );
}