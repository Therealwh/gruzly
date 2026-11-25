import { FileDown, Magnet, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, Input, InputIcon, Textarea, toast } from "@/components/ui";
import { CommandError, startFileDownload, startTorrent } from "@/lib/api";
import { parseUrlKind, splitBatchInput } from "@/lib/urls";
import { useAnalysisStore } from "@/stores/analysis";
import { useSettingsStore } from "@/stores/settings";

/** Reads a local .torrent file as base64 for aria2.addTorrent. */
const MAX_TORRENT_BYTES = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("torrent read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Files & torrents: direct HTTP/FTP downloads, magnet links, .torrent files,
 * and batch pastes. Everything lands in the unified queue.
 */
export function Files() {
  const { t } = useTranslation();
  const { pendingUrl, setPendingUrl } = useAnalysisStore();
  const [url, setUrl] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batch, setBatch] = useState("");
  const torrentInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (pendingUrl) {
      setUrl(pendingUrl);
      setPendingUrl(null);
    }
  }, [pendingUrl, setPendingUrl]);

  const addOne = useCallback(
    async (value: string): Promise<boolean> => {
      const kind = parseUrlKind(value);
      if (kind === "invalid") {
        toast.warning(`${t("errors.urlInvalid")}: ${value.slice(0, 60)}`);
        return false;
      }
      const folder = useSettingsStore.getState().downloadFolder || null;
      try {
        if (kind === "magnet") {
          await startTorrent({ magnet: value }, folder);
          toast.info(t("files.torrent.pickingHint"));
        } else {
          // .torrent URLs too — aria2 detects them via addUri
          await startFileDownload(value, undefined, folder);
        }
        return true;
      } catch (e) {
        if (e instanceof CommandError && e.code === "browserMode") {
          toast.warning(t("errors.generic"));
        } else if (e instanceof CommandError && e.code === "torrentActive") {
          toast.info(t("errors.torrentActive"));
        } else if (e instanceof CommandError && e.code === "torrentComplete") {
          toast.info(t("errors.torrentComplete"));
        } else {
          const detail = e instanceof Error ? e.message.slice(0, 140) : "";
          toast.error(detail ? `${t("errors.generic")}: ${detail}` : t("errors.generic"));
        }
        return false;
      }
    },
    [t],
  );

  const submit = useCallback(() => {
    if (batchMode) {
      const items = splitBatchInput(batch);
      if (items.length === 0) return;
      void (async () => {
        let ok = 0;
        for (const item of items) {
          if (await addOne(item)) ok += 1;
        }
        if (ok > 0) {
          toast.success(t("toasts.addedToQueue", { count: ok }));
          setBatch("");
        }
      })();
    } else {
      if (!url.trim()) return;
      void addOne(url.trim()).then((ok) => {
        if (ok) {
          toast.success(t("toasts.downloadStarted"));
          setUrl("");
        }
      });
    }
  }, [batchMode, batch, url, addOne, t]);

  const onTorrentFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_TORRENT_BYTES) {
        toast.error(t("errors.generic"));
        return;
      }
      const folder = useSettingsStore.getState().downloadFolder || null;
      try {
        const b64 = await fileToBase64(file);
        await startTorrent({ torrentBase64: b64 }, folder);
        toast.info(t("files.torrent.pickingHint"));
      } catch (e) {
        if (e instanceof CommandError && e.code === "browserMode") {
          toast.warning(t("errors.generic"));
        } else {
          toast.error(t("errors.generic"));
        }
      }
    },
    [t],
  );

  return (
    <div
      className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file?.name.toLowerCase().endsWith(".torrent")) {
          void onTorrentFile(file);
          return;
        }
        const text = e.dataTransfer.getData("text/plain");
        if (text) {
          setUrl(text);
        }
      }}
    >
      <p className="mb-4 text-xs text-text-muted">{t("files.subtitle")}</p>

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {batchMode ? (
          <Textarea
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder={t("files.add.batchPlaceholder")}
            rows={4}
            aria-label={t("files.add.batch")}
          />
        ) : (
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <InputIcon>
                <Magnet className="h-3.5 w-3.5" aria-hidden />
              </InputIcon>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("files.add.placeholder")}
                className="h-10 pl-9 pr-3 text-[13px]"
                aria-label={t("files.title")}
              />
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <Button type="submit" variant="gradient" size="md">
            <Plus className="h-4 w-4" aria-hidden />
            {batchMode ? t("files.add.batch") : t("files.add.button")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setBatchMode((v) => !v)}
          >
            {batchMode ? t("files.add.button") : t("files.add.batch")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => torrentInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t("files.add.torrentButton")}
          </Button>
          <input
            ref={torrentInputRef}
            type="file"
            accept=".torrent"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onTorrentFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </form>

      {dragging && (
        <div className="mt-3 flex h-16 items-center justify-center rounded-xl border border-dashed border-accent/50 bg-accent/5 text-xs text-accent-text">
          {t("files.add.dropHint")}
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={FileDown}
          title={t("files.empty.title")}
          hint={`${t("files.empty.hint")} · ${t("files.empty.magnetHint")}`}
          className="pb-16 pt-6"
        />
      </div>
    </div>
  );
}
