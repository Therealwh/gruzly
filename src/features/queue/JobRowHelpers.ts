import { toast } from "@/components/ui";

/** Opens a folder through the OS opener; failures surface as a toast. */
export async function openFolder(folder: string, failMessage: string): Promise<void> {
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(folder);
  } catch (e) {
    console.warn("openFolder failed:", e);
    toast.error(failMessage);
  }
}
