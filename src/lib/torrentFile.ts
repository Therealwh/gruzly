const MAX_TORRENT_BYTES = 10 * 1024 * 1024;

export function torrentFileToBase64(file: File): Promise<string> {
  if (file.size > MAX_TORRENT_BYTES) return Promise.reject(new Error("Torrent file exceeds 10 MiB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read torrent file"));
    reader.readAsDataURL(file);
  });
}

export function chooseTorrentFile(): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".torrent";
    input.hidden = true;
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    try {
      input.showPicker();
    } catch (error) {
      input.remove();
      reject(error);
    }
  });
}
