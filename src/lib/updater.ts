import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri, prepareShutdown } from "@/lib/api";

export type { Update };

/** Checks the GitHub release channel. Returns null outside the webview. */
export async function checkForAppUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  return check({ timeout: 15000 });
}

/** Downloads, installs and relaunches the app. */
export async function installAppUpdate(update: Update): Promise<void> {
  await prepareShutdown();
  await update.downloadAndInstall();
  await relaunch();
}
