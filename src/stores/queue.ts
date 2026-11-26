import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { isArchiveName } from "@/lib/archive";
import { t } from "@/lib/i18n";
import {
  CommandError,
  extractArchive,
  isTauri,
  listJobs,
  queueSlots,
  setJobOrder,
  type JobView,
  type ProgressEvent,
  type QueueSlots,
  type StateEvent,
  type TorrentReadyEvent,
} from "@/lib/api";

let orderWrite = Promise.resolve();

/**
 * Jobs already auto-extracted in this session. Completion can be reported
 * more than once (state re-emits), so this guards duplicates.
 */
const autoExtracted = new Set<string>();

type QueueState = {
  jobs: Map<string, JobView>;
  order: string[];
  connected: boolean;
  slots: QueueSlots | null;
  /** Last yt-dlp/aria2 status line per job (live activity). */
  activity: Map<string, string>;
  /** Torrent whose metadata resolved and awaits file selection. */
  torrentReady: TorrentReadyEvent | null;
  pendingTorrents: TorrentReadyEvent[];
  pendingActions: Set<string>;
  setActionPending: (id: string, pending: boolean) => boolean;
  hydrate: () => Promise<void>;
  applyProgress: (e: ProgressEvent) => void;
  applyState: (e: StateEvent) => void;
  applyActivity: (id: string, text: string) => void;
  applyTorrentReady: (e: TorrentReadyEvent) => void;
  dismissTorrent: (jobId: string) => void;
  /** Applies a drag-and-drop reordering (ids in their new display order). */
  applyOrder: (ids: string[]) => void;
  removeJob: (id: string) => void;
  attach: () => Promise<() => void>;
};

/** System notification for completed/failed downloads (Settings-gated). */
async function notifyOnTerminal(
  status: StateEvent["status"],
  title: string | null,
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
    const body = title ?? undefined;
    sendNotification({
      title: status === "completed" ? t("toasts.downloadCompleted") : t("toasts.downloadFailed"),
      body,
    });
  } catch {
    /* notifications unavailable */
  }
}

/**
 * Unpack a freshly completed archive when Settings → Downloads enables it.
 * Runs at most once per job id; failures surface as a toast, never as state.
 */
async function autoExtractCompleted(
  id: string,
  filename: string | null | undefined,
): Promise<void> {
  if (!isTauri() || !isArchiveName(filename) || autoExtracted.has(id)) return;
  // Claim the id before the first await so simultaneous completion events
  // cannot extract the same archive twice.
  autoExtracted.add(id);
  const { useSettingsStore } = await import("@/stores/settings");
  if (!useSettingsStore.getState().autoExtract) {
    autoExtracted.delete(id);
    return;
  }
  const { toast } = await import("@/components/ui");
  try {
    const destination = await extractArchive(id);
    toast.success(t("toasts.archiveExtracted", { folder: destination }));
  } catch (error) {
    const code = error instanceof CommandError ? error.code : null;
    toast.error(
      code === "archiveRarUnavailable"
        ? t("errors.archiveRarUnavailable")
        : t("errors.extractArchive"),
    );
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
  slots: null,
  activity: new Map(),
  torrentReady: null,
  pendingTorrents: [],
  pendingActions: new Set(),

  setActionPending: (id, pending) => {
    const { pendingActions } = get();
    if (pendingActions.has(id) === pending) return false;
    const next = new Set(pendingActions);
    if (pending) next.add(id);
    else next.delete(id);
    set({ pendingActions: next });
    return true;
  },

  hydrate: async () => {
    const before = get().jobs;
    try {
      const jobs = await listJobs();
      const current = get();
      const map = new Map<string, JobView>();
      for (const job of jobs) {
        const live = current.jobs.get(job.id);
        if (!live && before.has(job.id)) continue;
        map.set(job.id, live && live !== before.get(job.id)
          ? { ...live, url: job.url, folder: live.folder ?? job.folder, createdAt: job.createdAt }
          : job);
      }
      for (const [id, job] of current.jobs) {
        if (!map.has(id) && job !== before.get(id)) map.set(id, job);
      }
      const order = [...map.keys()];
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
      totalBytes: e.totalBytes,
      fraction: e.fraction,
      speed: e.speed,
      eta: e.eta,
      connections: e.connections ?? null,
      seeders: e.seeders ?? null,
      uploadSpeed: e.uploadSpeed ?? null,
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
        folder: e.folder,
        filename: e.filename,
        thumbnail: e.thumbnail,
        torrentPhase: e.torrentPhase,
        canRetry: e.canRetry,
        retryNeedsTorrent: e.retryNeedsTorrent,
        errorCode: e.errorCode,
      });
      const activity = new Map(get().activity);
      if (["completed", "failed", "canceled"].includes(e.status)) activity.delete(e.id);
      set({ jobs: next, activity });
      if (e.status === "completed" && e.title) {
        import("@/components/ui").then(({ toast }) =>
          toast.success(`${t("toasts.downloadCompleted")} — ${e.title}`),
        );
      }
      void notifyOnTerminal(e.status, e.title ?? existing.title);
      if (e.status === "completed") void autoExtractCompleted(e.id, e.filename);
    } else if (e.title !== null) {
      // New job announced before listJobs saw it.
      const next = new Map(jobs);
      next.set(e.id, {
        id: e.id,
        kind: e.kind,
        engine: e.engine,
        url: "",
        title: e.title,
        folder: e.folder,
        filename: e.filename,
        thumbnail: e.thumbnail,
        torrentPhase: e.torrentPhase,
        canRetry: e.canRetry,
        retryNeedsTorrent: e.retryNeedsTorrent,
        errorCode: e.errorCode,
        status: e.status,
        error: e.error,
        downloadedBytes: 0,
        totalBytes: null,
        fraction: null,
        speed: 0,
        eta: 0,
        createdAt: Date.now(),
      });
      set({ jobs: next, order: [...order, e.id] });
      if (e.status === "completed") void autoExtractCompleted(e.id, e.filename);
    }
  },

  applyActivity: (id: string, text: string) => {
    const next = new Map(get().activity);
    next.set(id, text);
    set({ activity: next });
  },

  applyTorrentReady: (e) => {
    const { torrentReady, pendingTorrents } = get();
    if (!torrentReady || torrentReady.jobId === e.jobId) {
      set({ torrentReady: e });
    } else if (!pendingTorrents.some(({ jobId }) => jobId === e.jobId)) {
      set({ pendingTorrents: [...pendingTorrents, e] });
    }
  },

  dismissTorrent: (jobId) => {
    const { torrentReady, pendingTorrents } = get();
    const remaining = pendingTorrents.filter((entry) => entry.jobId !== jobId);
    if (torrentReady?.jobId === jobId) {
      set({ torrentReady: remaining[0] ?? null, pendingTorrents: remaining.slice(1) });
    } else {
      set({ pendingTorrents: remaining });
    }
  },

  applyOrder: (ids) => {
    const { jobs, order } = get();
    const next = [
      ...ids.filter((id) => jobs.has(id)),
      ...order.filter((id) => !ids.includes(id)),
    ];
    set({ order: next });
    orderWrite = orderWrite.then(() => setJobOrder(next)).catch(() => undefined);
  },

  removeJob: (id) => {
    const next = new Map(get().jobs);
    next.delete(id);
    set({ jobs: next, order: get().order.filter((item) => item !== id) });
  },

  attach: async () => {
    if (!isTauri()) return () => undefined;
    const listeners: UnlistenFn[] = await Promise.all([
      listen<QueueSlots>("queue://slots", (e) => set({ slots: e.payload })),
      listen<ProgressEvent>("job://progress", (e) => get().applyProgress(e.payload)),
      listen<StateEvent>("job://state", (e) => get().applyState(e.payload)),
      listen<TorrentReadyEvent>("torrent://ready", (e) => get().applyTorrentReady(e.payload)),
      listen<{ id: string; text: string }>("job://activity", (e) =>
        get().applyActivity(e.payload.id, e.payload.text),
      ),
    ]);
    set({ connected: true });
    const previousSlots = get().slots;
    await Promise.all([
      get().hydrate(),
      queueSlots().then((slots) => {
        if (get().slots === previousSlots) set({ slots });
      }).catch(() => undefined),
    ]);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const fn of listeners) fn();
    };
  },
}));
