import { listen } from "@tauri-apps/api/event";
import { toast } from "@/components/ui";
import { isTauri, startFileDownload, startTorrent, takePendingLinks } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { PageId } from "@/lib/navigation";
import { parseUrlKind } from "@/lib/urls";
import { useAnalysisStore } from "@/stores/analysis";
import { useSettingsStore } from "@/stores/settings";

/** Mirrors `core::links::EVENT_LINK`. */
const EVENT_LINK = "app://link";

type Navigate = (page: PageId) => void;

/**
 * Handles a link from the browser extension, a gruzly:// deep link or the
 * command line exactly like a manual paste: video pages open the preview,
 * everything else goes straight into the queue.
 */
export async function adoptIncomingLink(url: string, navigate: Navigate): Promise<void> {
  const kind = parseUrlKind(url);
  if (kind === "invalid") {
    toast.warning(t("errors.urlInvalid"));
    return;
  }
  if (kind === "video") {
    useAnalysisStore.getState().setPendingUrl(url);
    navigate("video");
    return;
  }
  const folder = useSettingsStore.getState().downloadFolder || null;
  try {
    if (kind === "magnet") {
      await startTorrent({ magnet: url }, folder);
      toast.info(t("files.torrent.pickingHint"));
    } else {
      await startFileDownload(url, undefined, folder);
      toast.success(t("toasts.downloadStarted"));
    }
    navigate("downloads");
  } catch (e) {
    toast.error(e instanceof Error && e.message ? e.message : t("errors.generic"));
  }
}

/** Subscribes to incoming links and drains any that arrived before mount. */
export async function attachIncomingLinks(navigate: Navigate): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const unlisten = await listen<string>(EVENT_LINK, (event) => {
    void adoptIncomingLink(event.payload, navigate);
  });
  try {
    for (const url of await takePendingLinks()) {
      void adoptIncomingLink(url, navigate);
    }
  } catch {
    /* nothing queued */
  }
  return unlisten;
}
