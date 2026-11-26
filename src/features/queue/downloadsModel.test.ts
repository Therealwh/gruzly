import { describe, expect, it } from "vitest";
import type { JobView } from "@/lib/api";
import { downloadProgress, downloadTab, isWaitingForPeers, matchesDownload, moveVisibleDownload, transferSpeeds } from "./downloadsModel";

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job", kind: "torrent", title: "Test archive", url: "magnet:?test", filename: "archive.zip",
    engine: "aria2", folder: null, status: "queued", error: null,
    downloadedBytes: 0, totalBytes: null, fraction: null, speed: 0, eta: 0, createdAt: 0,
    ...overrides,
  };
}

describe("Downloads model", () => {
  it("preserves hidden positions when moving a filtered job in either direction", () => {
    const order = ["hidden-active", "first", "hidden-kind", "second", "hidden-error", "third"];
    const visible = new Set(["first", "second", "third"]);
    const move = moveVisibleDownload(order, visible, "first", "third");
    expect(move).toEqual({
      order: ["hidden-active", "second", "hidden-kind", "third", "hidden-error", "first"],
      position: 3, count: 3,
    });
    expect(moveVisibleDownload(move!.order, visible, "first", "second")?.order).toEqual(order);
  });

  it("skips no-op and stale drag targets", () => {
    const order = ["first", "second", "hidden"];
    const visible = new Set(["first", "second"]);
    expect(moveVisibleDownload(order, visible, "first", "first")).toBeNull();
    expect(moveVisibleDownload(order, visible, "first", "hidden")).toBeNull();
    expect(moveVisibleDownload(order, visible, "removed", "second")).toBeNull();
  });

  it("distinguishes queued work, torrent setup, and failed work", () => {
    expect(downloadTab(job())).toBe("queued");
    expect(downloadTab(job({ torrentPhase: "metadata" }))).toBe("active");
    expect(downloadTab(job({ torrentPhase: "selectFiles" }))).toBe("active");
    expect(downloadTab(job({ status: "failed" }))).toBe("errors");
    expect(downloadTab(job({ status: "completed" }))).toBe("completed");
  });

  it("matches the download type and can search filenames as well as titles and URLs", () => {
    expect(matchesDownload(job(), "torrent", ".zip")).toBe(true);
    expect(matchesDownload(job(), "all", "magnet")).toBe(true);
    expect(matchesDownload(job(), "file", "test")).toBe(false);
  });

  it("shows waiting for peers only with a measured zero and retains unknown progress", () => {
    const unknown = job({ status: "downloading" });
    expect(isWaitingForPeers(unknown)).toBe(false);
    expect(isWaitingForPeers({ ...unknown, connections: 0 })).toBe(true);
    expect(isWaitingForPeers({ ...unknown, connections: 0, speed: 10 })).toBe(false);
    expect(downloadProgress(unknown)).toBeNull();
    expect(downloadProgress(job({ torrentPhase: "metadata", fraction: 0 }))).toBeNull();
    expect(downloadProgress(job({ totalBytes: 500, downloadedBytes: 250 }))).toBe(0.5);
  });

  it("sums active transfer speeds and ignores stale speeds from paused or setup jobs", () => {
    expect(transferSpeeds([
      job({ kind: "file", status: "downloading", speed: 100 }),
      job({ status: "downloading", speed: 200, uploadSpeed: 10 }),
      job({ status: "seeding", speed: 999, uploadSpeed: 20 }),
      job({ status: "paused", speed: 999, uploadSpeed: 999 }),
      job({ status: "downloading", torrentPhase: "metadata", speed: 999, uploadSpeed: 999 }),
    ])).toEqual({ download: 300, upload: 30 });
  });
});
