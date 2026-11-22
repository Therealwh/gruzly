import { Pencil, Plus, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, ConfirmModal, EmptyState, Input, Modal, toast } from "@/components/ui";
import { t } from "@/lib/i18n";
import { create } from "zustand";
import { cn } from "@/lib/utils";

/* Preset CRUD — real, persists in localStorage until the Rust store lands (M3). */

export type PresetKind = "video" | "file";
export type Preset = {
  id: string;
  name: string;
  kind: PresetKind;
  quality: "best" | "audio";
  folder: string;
  domain: string;
};

type PresetStore = {
  presets: Preset[];
  defaultId: string | null;
  upsert: (p: Preset) => void;
  remove: (id: string) => void;
  setDefault: (id: string | null) => void;
};

const STORAGE_KEY = "gruzly.presets";

function load(): { presets: Preset[]; defaultId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { presets: Preset[]; defaultId: string | null };
  } catch {
    /* ignore */
  }
  return { presets: [], defaultId: null };
}

export const usePresetStore = create<PresetStore>((set, get) => ({
  ...load(),
  upsert: (preset) => {
    const { presets } = get();
    const next = presets.some((p) => p.id === preset.id)
      ? presets.map((p) => (p.id === preset.id ? preset : p))
      : [...presets, preset];
    set({ presets: next });
    savePresets(next, get().defaultId);
    toast.success(t("toasts.presetSaved"));
  },
  remove: (id) => {
    const { presets, defaultId } = get();
    const next = presets.filter((p) => p.id !== id);
    set({ presets: next, defaultId: defaultId === id ? null : defaultId });
    savePresets(next, defaultId === id ? null : defaultId);
    toast.success(t("toasts.presetDeleted"));
  },
  setDefault: (id) => {
    set({ defaultId: id });
    savePresets(get().presets, id);
  },
}));

function savePresets(presets: Preset[], defaultId: string | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ presets, defaultId }));
  } catch {
    /* ignore */
  }
}

/* ------------------------------- Page ------------------------------- */

export function Presets() {
  const { t } = useTranslation();
  const { presets, defaultId, remove, setDefault } = usePresetStore();
  const [editor, setEditor] = useState<Preset | "new" | null>(null);
  const [deleting, setDeleting] = useState<Preset | null>(null);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-text-muted">{t("presets.subtitle")}</p>
        <Button size="md" variant="gradient" onClick={() => setEditor("new")}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("presets.create")}
        </Button>
      </div>

      {presets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={SlidersHorizontal}
            title={t("presets.empty.title")}
            hint={t("presets.empty.hint")}
            className="pb-16 pt-6"
            actionLabel={t("presets.create")}
            onAction={() => setEditor("new")}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((p) => (
            <li
              key={p.id}
              className={cn(
                "group relative flex flex-col rounded-xl border p-4 shadow-panel transition-colors",
                defaultId === p.id
                  ? "border-accent/40 bg-accent/6"
                  : "border-border bg-surface-2 hover:border-border-strong",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-text">{p.name}</p>
                  <p className="mt-0.5 text-2xs text-text-muted">
                    {p.kind === "video" ? t("presets.fields.kindVideo") : t("presets.fields.kindFile")}
                    {" · "}
                    {p.quality === "best" ? t("presets.fields.qualityBest") : t("presets.fields.qualityAudio")}
                  </p>
                </div>
                {defaultId === p.id && <Badge tone="accent">{t("presets.defaultBadge")}</Badge>}
              </div>
              {(p.folder || p.domain) && (
                <p className="mt-2 truncate text-2xs text-text-disabled" data-selectable>
                  {p.domain ? `@${p.domain}` : ""}
                  {p.domain && p.folder ? " · " : ""}
                  {p.folder}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDefault(defaultId === p.id ? null : p.id)}
                >
                  <Star
                    className={cn("h-3.5 w-3.5", defaultId === p.id && "fill-warning text-warning")}
                    aria-hidden
                  />
                  {defaultId === p.id ? t("presets.defaultBadge") : t("presets.setDefault")}
                </Button>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditor(p)} aria-label={t("common.edit")}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(p)}
                    aria-label={t("common.delete")}
                    className="hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PresetEditor
        preset={editor === "new" || editor === null ? null : editor}
        open={editor !== null}
        onClose={() => setEditor(null)}
      />

      <ConfirmModal
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={t("presets.deleteConfirm.title")}
        body={t("presets.deleteConfirm.body", { name: deleting?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (deleting) remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function PresetEditor({
  preset,
  open,
  onClose,
}: {
  preset: Preset | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upsert = usePresetStore((s) => s.upsert);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PresetKind>("video");
  const [quality, setQuality] = useState<"best" | "audio">("best");
  const [folder, setFolder] = useState("");
  const [domain, setDomain] = useState("");
  const [key, setKey] = useState<string | null>(null);

  // Reset local fields whenever a different preset opens.
  const presetKey = preset?.id ?? "new";
  if (open && key !== presetKey) {
    setKey(presetKey);
    setName(preset?.name ?? "");
    setKind(preset?.kind ?? "video");
    setQuality(preset?.quality ?? "best");
    setFolder(preset?.folder ?? "");
    setDomain(preset?.domain ?? "");
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={preset ? t("presets.edit") : t("presets.create")}
      size="md"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          upsert({
            id: preset?.id ?? `p-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
            name: name.trim(),
            kind,
            quality,
            folder: folder.trim(),
            domain: domain.trim().toLowerCase(),
          });
          onClose();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-2xs font-medium text-text-secondary">
            {t("presets.fields.name")}
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("presets.fields.namePlaceholder")}
            required
            maxLength={60}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-2xs font-medium text-text-secondary">
              {t("presets.fields.kind")}
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PresetKind)}
              className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none"
            >
              <option value="video">{t("presets.fields.kindVideo")}</option>
              <option value="file">{t("presets.fields.kindFile")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-medium text-text-secondary">
              {t("presets.fields.quality")}
            </span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as "best" | "audio")}
              className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none"
            >
              <option value="best">{t("presets.fields.qualityBest")}</option>
              <option value="audio">{t("presets.fields.qualityAudio")}</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-2xs font-medium text-text-secondary">
            {t("presets.fields.folder")} <span className="text-text-disabled">({t("common.optional")})</span>
          </span>
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={t("presets.fields.folderPlaceholder")}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs font-medium text-text-secondary">
            {t("presets.fields.domain")} <span className="text-text-disabled">({t("common.optional")})</span>
          </span>
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t("presets.fields.domainPlaceholder")}
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
