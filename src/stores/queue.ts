import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  listJobs,
  type JobView,
  type ProgressEvent,
  type StateEvent,
  type TorrentReadyEvent,
} from "@/lib/api";

type QueueState = {
  jobs: Map<string, JobView>;
  order: string[];
  connected: boolean;
  /** Torrent whose metadata resolved and awaits file selection. */
  torrentReady: TorrentReadyEvent | null;
  hydrate: () => Promise<void>;
  applyProgress: (e: ProgressEvent) => void;
  applyState: (e: StateEvent) => void;
  applyTorrentReady: (e: TorrentReadyEvent) => void;
  dismissTorrent: () => void;
  attach: () => Promise<() => void>;
};

let unlisten: UnlistenFn[] = [];

/**
 * Live queue state, driven by Rust events (throttled ≤4/s per job).
 * `Map` keeps per-job updates O(1); `order` mirrors Rust insertion order.
 */
export const useQueueStore = create<QueueState>((set, get) => ({
  jobs: new Map(),
  order: [],
  connected: false,
  torrentReady: null,

  hydrate: async () => {
    try {
      const jobs = await listJobs();
      const map = new Map<string, JobView>();
      for (const j of jobs) map.set(j.id, j);
      set({ jobs: map, order: jobs.map((j) => j.id), connected: true });
    } catch {
      // browser mode or IPC hiccup — leave empty
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
        error: e.error ?? existing.error,
        title: e.title ?? existing.title,
      });
      set({ jobs: next });
    } else if (e.title !== null) {
      // New job announced before listJobs saw it.
      const next = new Map(jobs);
      next.set(e.id, {
        id: e.id,
        kind: "video",
        engine: "yt-dlp",
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

  applyTorrentReady: (e) => {
    set({ torrentReady: e });
  },

  dismissTorrent: () => set({ torrentReady: null }),

  attach: async () => {
    // detach previous listeners first (StrictMode double-mount safe)
    for (const fn of unlisten) fn();
    unlisten = await Promise.all([
      listen<ProgressEvent>("job://progress", (e) => get().applyProgress(e.payload)),
      listen<StateEvent>("job://state", (e) => get().applyState(e.payload)),
      listen<TorrentReadyEvent>("torrent://ready", (e) => get().applyTorrentReady(e.payload)),
    ]);
    set({ connected: true });
    return () => {
      for (const fn of unlisten) fn();
      unlisten = [];
    };
  },
}));
