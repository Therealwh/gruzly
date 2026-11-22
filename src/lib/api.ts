import { invoke } from "@tauri-apps/api/core";

/** Static app facts (version, name). */
export type AppInfo = {
  name: string;
  version: string;
  os: string;
  arch: string;
};

/** Live engine facts as probed by the Rust core. */
export type EngineInfo = {
  id: "yt-dlp" | "aria2" | "ffmpeg";
  present: boolean;
  version: string | null;
  /** Where the binary was found (bundled sidecar dir or PATH). */
  source: "bundled" | "path" | null;
};

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function getEngineInfo(): Promise<EngineInfo[]> {
  return invoke<EngineInfo[]>("get_engine_info");
}
