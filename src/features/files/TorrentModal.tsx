import { Check, Download, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, toast } from "@/components/ui";
import { cancelJob, CommandError, selectTorrentFiles, type TorrentReadyEvent } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQueueStore } from "@/stores/queue";

/**
 * Torrent file selection: metadata resolved, user picks files, transfer starts.
 * Dismissing leaves the task waiting for selection.
 */
export function TorrentModal() {
  const info = useQueueStore((state) => state.torrentReady);
  return info ? <TorrentPicker key={info.jobId} info={info} /> : null;
}

function TorrentPicker({ info }: { info: TorrentReadyEvent }) {
  const { t } = useTranslation();
  const dismissTorrent = useQueueStore((state) => state.dismissTorrent);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [starting, setStarting] = useState(false);
  const effective = useMemo(() => {
    if (selected === null) {
      // initial: preselect what aria2 marked selected
      return new Set(info.files.filter((f) => f.selected).map((f) => f.index));
    }
    return selected;
  }, [info, selected]);

  const totalSelected = info.files
    .filter((f) => effective.has(f.index))
    .reduce((acc, f) => acc + f.length, 0);
  const totalAll = info.files.reduce((acc, f) => acc + f.length, 0);

  const close = () => {
    setSelected(null);
    dismissTorrent(info.jobId);
  };

  const cancel = async () => {
    try {
      await cancelJob(info.jobId);
      close();
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  const confirm = async () => {
    if (effective.size === 0) {
      toast.warning(t("files.torrent.selectFiles"));
      return;
    }
    setStarting(true);
    try {
      await selectTorrentFiles(info.jobId, [...effective]);
      toast.success(t("downloads.selectionConfirmed"));
      close();
    } catch (e) {
      if (e instanceof CommandError && e.code === "browserMode") {
        toast.warning(t("errors.generic"));
      } else {
        toast.error(e instanceof Error ? e.message : t("errors.generic"));
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !starting) close();
      }}
      title={info.name}
      description={t("files.torrent.selectFiles")}
      size="lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="tnum text-2xs text-text-muted">
          {t("files.torrent.totalSize")}: {formatBytes(totalAll, undefined)} ·{" "}
          {t("files.torrent.selectedSize")}: {formatBytes(totalSelected, undefined)}
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(info.files.map((f) => f.index)))}>
            {t("common.selectAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("common.deselectAll")}
          </Button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
        {info.files.map((f) => {
          const on = effective.has(f.index);
          const rel = f.path.replace(/^.*[/\\]([^/\\]+[/\\]?.*)$/, "$1");
          return (
            <button
              key={f.index}
              type="button"
              aria-pressed={on}
              disabled={starting}
              onClick={() =>
                setSelected((prev) => {
                  const base = prev ?? new Set(info.files.filter((x) => x.selected).map((x) => x.index));
                  const next = new Set(base);
                  if (next.has(f.index)) next.delete(f.index);
                  else next.add(f.index);
                  return next;
                })
              }
              className={cn(
                "flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0",
                on ? "bg-accent/6" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  on ? "border-accent bg-accent text-white" : "border-border-strong",
                )}
                aria-hidden
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-text" data-selectable title={f.path}>
                {rel}
              </span>
              <span className="tnum shrink-0 text-2xs text-text-muted">{formatBytes(f.length, undefined)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" disabled={starting} onClick={() => void cancel()}>
          <X className="h-3.5 w-3.5" aria-hidden />
          {t("common.cancel")}
        </Button>
        <Button variant="gradient" onClick={() => void confirm()} disabled={starting || effective.size === 0}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t("common.download")} ({effective.size})
        </Button>
      </div>
    </Modal>
  );
}
