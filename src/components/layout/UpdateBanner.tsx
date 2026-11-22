import { AnimatePresence, motion } from "framer-motion";
import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/update";

/**
 * App self-update card: appears when the release channel has a newer
 * version; download → install → relaunch in one click.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { status, version, notes, checkOnStartup, install, dismiss } = useUpdateStore();

  useEffect(() => {
    const timer = window.setTimeout(() => void checkOnStartup(), 4000);
    return () => window.clearTimeout(timer);
  }, [checkOnStartup]);

  const visible = status === "available" || status === "downloading";
  const busy = status === "downloading";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="fixed bottom-4 left-4 z-[85] w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-accent/30 glass-strong p-3.5 shadow-pop"
          role="status"
        >
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg accent-gradient">
              <Sparkles className="h-4 w-4 text-white" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text">
                {t("update.available", { version: version ?? "" })}
              </p>
              {notes && (
                <p className="mt-1 line-clamp-3 text-2xs leading-relaxed text-text-muted" data-selectable>
                  {notes}
                </p>
              )}
            </div>
            {!busy && (
              <button
                onClick={dismiss}
                aria-label={t("common.close")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => void install()}
            disabled={busy}
            className={cn(
              "mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors",
              "accent-gradient text-text-on-accent hover:brightness-110 active:brightness-95",
              busy && "opacity-70",
            )}
          >
            {busy ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? t("update.downloading") : t("update.install")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
