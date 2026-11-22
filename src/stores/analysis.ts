import { create } from "zustand";
import { analyzeUrl, CommandError, type Analysis } from "@/lib/api";
import { t } from "@/lib/i18n";
import { toast } from "@/components/ui";

type AnalysisState = {
  /** URL handed over from another page (Dashboard quick paste). */
  pendingUrl: string | null;
  analyzing: boolean;
  analysis: Analysis | null;
  error: { code: string; message: string } | null;
  setPendingUrl: (url: string | null) => void;
  analyze: (url: string) => Promise<void>;
  reset: () => void;
};

export const useAnalysisStore = create<AnalysisState>((set) => ({
  pendingUrl: null,
  analyzing: false,
  analysis: null,
  error: null,
  setPendingUrl: (url) => set({ pendingUrl: url }),

  analyze: async (url) => {
    set({ analyzing: true, analysis: null, error: null });
    try {
      const analysis = await analyzeUrl(url);
      set({ analysis, analyzing: false });
    } catch (e) {
      if (e instanceof CommandError && e.code === "browserMode") {
        set({
          analyzing: false,
          error: { code: "browserMode", message: t("errors.generic") },
        });
        return;
      }
      if (e instanceof CommandError) {
        set({ analyzing: false, error: { code: e.code, message: e.message } });
        toast.error(t("errors.analysisFailed"));
      } else {
        set({
          analyzing: false,
          error: { code: "generic", message: e instanceof Error ? e.message : String(e) },
        });
        toast.error(t("errors.analysisFailed"));
      }
    }
  },

  reset: () => set({ analysis: null, error: null, analyzing: false }),
}));
