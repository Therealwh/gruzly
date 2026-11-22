import { create } from "zustand";
import { checkForAppUpdate, installAppUpdate, type Update } from "@/lib/updater";
import { t } from "@/lib/i18n";
import { toast } from "@/components/ui";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "failed";

type UpdateState = {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  _update: Update | null;
  /** Startup check (debounced by the caller). Silent when up to date. */
  checkOnStartup: () => Promise<void>;
  /** Explicit check (About page): surfaces "up to date" feedback. */
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  _update: null,

  checkOnStartup: async () => {
    if (get().status !== "idle") return;
    try {
      const update = await checkForAppUpdate();
      if (update) {
        set({
          status: "available",
          version: update.version,
          notes: update.body ?? null,
          _update: update,
        });
      }
    } catch {
      /* offline or no channel yet — silent for the startup check */
    }
  },

  checkNow: async () => {
    set({ status: "checking" });
    try {
      const update = await checkForAppUpdate();
      if (update) {
        set({ status: "available", version: update.version, notes: update.body ?? null, _update: update });
      } else {
        set({ status: "idle", version: null, _update: null });
        toast.success(t("about.upToDate"));
      }
    } catch {
      set({ status: "idle" });
      toast.error(t("update.failed"));
    }
  },

  install: async () => {
    const update = get()._update;
    if (!update) return;
    set({ status: "downloading" });
    try {
      await installAppUpdate(update);
      // relaunch() kills the process; this line only runs on failure paths
      set({ status: "idle" });
    } catch {
      set({ status: "failed" });
      toast.error(t("update.failed"));
    }
  },

  dismiss: () => set({ status: "idle", version: null, notes: null, _update: null }),
}));
