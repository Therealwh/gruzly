import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import {
  isTauri,
  listJobs,
  setJobOrder,
  type JobView,
  type ProgressEvent,
  type StateEvent,
  type TorrentReadyEvent,
} from "@/lib/api";

type QueueState = {
  jobs: Map<string, JobView>;
  order: string[];
  connected: boolean;
  /** Last yt-dlp/aria2 status line per job (live activity). */
  activity: Map<string, string>;
  /** Torrent whose metadata resolved and awaits file selection. */
  torrentReady: TorrentReadyEvent | null;
  hydrate: () => Promise<void>;
  applyProgress: (e: ProgressEvent) => void;
  applyState: (e: StateEvent) => void;
  applyActivity: (id: string, text: string) => void;
  applyTorrentReady: (e: TorrentReadyEvent) => void;
  dismissTorrent: () => void;
  /** Applies a drag-and-drop reordering (ids in their new display order). */
  applyOrder: (ids: string[]) => void;
  removeJob: (id: string) => void;
  attach: () => Promise<() => void>;
};

/** System notification for completed/failed downloads (Settings-gated). */
async function notifyOnTerminal(
  status: StateEvent["status"],
  title: string | null,
  error: string | null,
): Promise<void> {
  if (!isTauri() || (status !== "completed" && status !== "failed")) return;
  const { useSettingsStore } = await import("@/stores/settings");
  if (!useSettingsStore.getState().notifications) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (!(await isPermissionGranted())) {
      if (!(await requestPermission())) return;
    }
    const { t } = await import("@/lib/i18n");
    const body = [title, error].filter(Boolean).join("\n");
    sendNotification({
      title: status === "completed" ? t("toasts.downloadCompleted") : t("toasts.downloadFailed"),
      body,
    });
  } catch {
    /* notifications unavailable */
  }
}

/**
 * Live queue state, driven by Rust events (throttled ≤4/s per job).
 * `Map` keeps per-job updates O(1); `order` mirrors Rust insertion order.
 */
export const useQueueStore = create<QueueState>((set, get) => ({
  jobs: new Map(),
  order: [],
  connected: false,
  activity: new Map(),
  torrentReady: null,

  hydrate: async () => {
    try {
      const jobs = await listJobs();
      const current = get();
      const map = new Map(current.jobs);
      for (const job of jobs) {
        const live = map.get(job.id);
        map.set(job.id, live ? { ...job, ...live } : job);
      }
      const snapshotOrder = jobs.map((job) => job.id);
      const order = [...snapshotOrder, ...current.order.filter((id) => !map.has(id))];
      set({ jobs: map, order, connected: true });
    } catch {
      set({ connected: false });
    }
  },

  applyProgress: (e) => {
    const { jobs, order } = get();
    const existing = jobs.get(e.id);
    if (!existing) return;
    const next = new Map(jobs);
    next.set(e.id, {
      ...existing,
      downloadedBytes: e.downloadedBytes,
      totalBytes: e.totalBytes ?? existing.totalBytes,
      speed: e.speed,
      eta: e.eta,
    });
    set({ jobs: next, order: order.length ? order : [...next.keys()] });
  },

  applyState: (e) => {
    const { jobs, order } = get();
    const existing = jobs.get(e.id);
    if (existing) {
      const next = new Map(jobs);
      next.set(e.id, {
        ...existing,
        status: e.status,
        kind: e.kind,
        engine: e.engine,
        error: e.error,
        title: e.title ?? existing.title,
      });
      const activity = new Map(get().activity);
      if (["completed", "failed", "canceled"].includes(e.status)) activity.delete(e.id);
      set({ jobs: next, activity });
      if (e.status === "completed" && e.title) {
        import("@/components/ui").then(({ toast }) =>
          toast.success(`${t("toasts.downloadCompleted")} — ${e.title}`),
        );
      }
      void notifyOnTerminal(e.status, e.title ?? existing.title, e.error);
    } else if (e.title !== null) {
      // New job announced before listJobs saw it.
      const next = new Map(jobs);
      next.set(e.id, {
        id: e.id,
        kind: e.kind,
        engine: e.engine,
        url: "",
        title: e.title,
        folder: null,
        filename: null,
        status: e.status,
        error: e.error,
        downloadedBytes: 0,
        totalBytes: null,
        speed: 0,
        eta: 0,
        createdAt: Date.now(),
      });
      set({ jobs: next, order: [...order, e.id] });
    }
  },

  applyActivity: (id: string, text: string) => {
    const next = new Map(get().activity);
    next.set(id, text);
    set({ activity: next });
  },

  applyTorrentReady: (e) => {
    set({ torrentReady: e });
  },

  dismissTorrent: () => set({ torrentReady: null }),

  applyOrder: (ids) => {
    const { jobs, order } = get();
    const next = [
      ...ids.filter((id) => jobs.has(id)),
      ...order.filter((id) => !ids.includes(id)),
    ];
    set({ order: next });
    void setJobOrder(next).catch(() => undefined);
  },

  removeJob: (id) => {
    const next = new Map(get().jobs);
    next.delete(id);
    set({ jobs: next, order: get().order.filter((item) => item !== id) });
  },

  attach: async () => {
    if (!isTauri()) return () => undefined;
    const listeners: UnlistenFn[] = await Promise.all([
      listen<ProgressEvent>("job://progress", (e) => get().applyProgress(e.payload)),
      listen<StateEvent>("job://state", (e) => get().applyState(e.payload)),
      listen<TorrentReadyEvent>("torrent://ready", (e) => get().applyTorrentReady(e.payload)),
      listen<{ id: string; text: string }>("job://activity", (e) =>
        get().applyActivity(e.payload.id, e.payload.text),
      ),
    ]);
    set({ connected: true });
    await get().hydrate();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const fn of listeners) fn();
    };
  },
}));
