import { FileDown, Magnet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, Input, InputIcon, toast } from "@/components/ui";
import { parseUrlKind } from "@/lib/urls";
import { useAnalysisStore } from "@/stores/analysis";

export function Files() {
  const { t } = useTranslation();
  const { pendingUrl, setPendingUrl } = useAnalysisStore();
  const [url, setUrl] = useState("");

  // Pull URL handed over from the Dashboard (files/magnet/torrent kinds).
  useEffect(() => {
    if (pendingUrl) {
      setUrl(pendingUrl);
      setPendingUrl(null);
    }
  }, [pendingUrl, setPendingUrl]);

  const add = useCallback(
    (value: string) => {
      const kind = parseUrlKind(value);
      if (kind === "invalid") {
        toast.warning(t("errors.urlInvalid"));
        return;
      }
      // M2 wires this into the aria2 queue.
      toast.info(t("files.add.button"));
    },
    [t],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
      <p className="mb-4 text-xs text-text-muted">{t("files.subtitle")}</p>

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          add(url);
        }}
      >
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
          <Button type="submit" variant="gradient" size="lg">
            {t("files.add.button")}
          </Button>
        </div>
      </form>

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
