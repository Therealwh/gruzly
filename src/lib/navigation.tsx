import {
  Clock,
  Download,
  FileDown,
  Home,
  Info,
  Settings,
  SlidersHorizontal,
  Video,
  type LucideIcon,
} from "lucide-react";

export type PageId =
  | "dashboard"
  | "downloads"
  | "video"
  | "files"
  | "history"
  | "presets"
  | "settings"
  | "about";

export type NavItem = {
  id: PageId;
  labelKey: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: Home },
  { id: "downloads", labelKey: "nav.downloads", icon: Download },
  { id: "video", labelKey: "nav.video", icon: Video },
  { id: "files", labelKey: "nav.files", icon: FileDown },
  { id: "history", labelKey: "nav.history", icon: Clock },
  { id: "presets", labelKey: "nav.presets", icon: SlidersHorizontal },
  { id: "settings", labelKey: "nav.settings", icon: Settings },
  { id: "about", labelKey: "nav.about", icon: Info },
];

export function isPageId(value: string): value is PageId {
  return NAV_ITEMS.some((item) => item.id === value);
}
