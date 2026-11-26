/** Archive suffixes understood by the Rust extractor (`core::archive`). */
const ARCHIVE_SUFFIXES = [".tar.gz", ".tgz", ".zip", ".7z", ".tar", ".gz", ".rar"] as const;

/** True when a completed filename can be unpacked by Gruzly. */
export function isArchiveName(name?: string | null): boolean {
  if (!name) return false;
  const lower = name.trim().toLowerCase();
  return ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}
