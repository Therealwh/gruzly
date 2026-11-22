import { create } from "zustand";

/**
 * Hand-off between pages: the URL typed on the Dashboard follows the user
 * into the Video / Files section for analysis.
 */
type AnalysisState = {
  pendingUrl: string | null;
  setPendingUrl: (url: string | null) => void;
};

export const useAnalysisStore = create<AnalysisState>((set) => ({
  pendingUrl: null,
  setPendingUrl: (url) => set({ pendingUrl: url }),
}));
