/** 平台或项目级 PAC 预设（抓包页一键填入） */
export type CapturePacPreset = {
  id: string;
  label: string;
  hosts: string;
};

/** 当前项目的抓包路由配置（由主进程读取 project.yaml / platform.config） */
export type ProjectCaptureProfile = {
  pacHosts: string[];
  pacHostsCsv: string;
  templateLabel: string;
  presets: CapturePacPreset[];
};