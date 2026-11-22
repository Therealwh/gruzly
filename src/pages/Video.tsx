import { Link2, Search, Video as VideoIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, Input, InputIcon, toast } from "@/components/ui";
import { PreviewModal } from "@/features/video/PreviewModal";
import { parseUrlKind } from "@/lib/urls";
import { useAnalysisStore } from "@/stores/analysis";

/**
 * Video section: analyze a link → preview modal with player, format table
 * and presets, then download.
 */
export function Video() {
  const { t } = useTranslation();
  const { pendingUrl, setPendingUrl, analyzing, analysis, error, analyze } = useAnalysisStore();
  const [url, setUrl] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (pendingUrl) {
      setUrl(pendingUrl);
      setPendingUrl(null);
      void analyze(pendingUrl);
      setModalOpen(true);
    }
  }, [pendingUrl, setPendingUrl, analyze]);

  const submit = useCallback(() => {
    const kind = parseUrlKind(url);
    if (kind === "invalid") {
      toast.warning(t("errors.urlInvalid"));
      return;
    }
    if (kind !== "video") {
      toast.info(t("errors.urlUnsupported"));
      return;
    }
    void analyze(url);
    setModalOpen(true);
  }, [url, t, analyze]);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
      <p className="mb-4 text-xs text-text-muted">{t("video.subtitle")}</p>

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <InputIcon>
              <Link2 className="h-3.5 w-3.5" aria-hidden />
            </InputIcon>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("video.analyze.placeholder")}
              className="h-10 pl-9 pr-3 text-[13px]"
              aria-label={t("video.title")}
            />
          </div>
          <Button type="submit" variant="gradient" size="lg" disabled={analyzing}>
            <Search className="h-4 w-4" aria-hidden />
            {analyzing ? t("video.analyze.analyzing") : t("video.analyze.button")}
          </Button>
        </div>
      </form>

      <div className="flex flex-1 items-center justify-center">
        {analysis || analyzing || error ? null : (
          <EmptyState
            icon={VideoIcon}
            title={t("video.empty.title")}
            hint={t("video.empty.hint")}
            className="pb-16 pt-6"
          />
        )}
      </div>

      <p className="pb-1 text-center text-2xs text-text-disabled">{t("video.empty.sites")}</p>

      <PreviewModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
