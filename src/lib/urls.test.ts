import { describe, expect, it } from "vitest";
import { extractFirstUrl, parseUrlKind, splitBatchInput } from "./urls";

describe("parseUrlKind", () => {
  it("routes video domains to video", () => {
    expect(parseUrlKind("https://www.youtube.com/watch?v=abc")).toBe("video");
    expect(parseUrlKind("https://youtu.be/abc")).toBe("video");
    expect(parseUrlKind("https://rutube.ru/video/abc/")).toBe("video");
    expect(parseUrlKind("https://vkvideo.ru/video-1_2")).toBe("video");
    expect(parseUrlKind("https://ok.ru/video/123")).toBe("video");
    expect(parseUrlKind("https://dzen.ru/video/watch/abc")).toBe("video");
    expect(parseUrlKind("https://www.twitch.tv/videos/123")).toBe("video");
    expect(parseUrlKind("https://www.bilibili.com/video/BVabc")).toBe("video");
    expect(parseUrlKind("https://vimeo.com/12345")).toBe("video");
  });

  it("routes magnets", () => {
    expect(parseUrlKind("magnet:?xt=urn:btih:abcdef&dn=name")).toBe("magnet");
  });

  it("routes .torrent files", () => {
    expect(parseUrlKind("https://example.org/linux.torrent")).toBe("torrent");
  });

  it("routes plain files", () => {
    expect(parseUrlKind("https://example.org/archive.zip")).toBe("file");
    expect(parseUrlKind("ftp://example.org/data.iso")).toBe("file");
  });

  it("rejects garbage", () => {
    expect(parseUrlKind("")).toBe("invalid");
    expect(parseUrlKind("not a url")).toBe("invalid");
    expect(parseUrlKind("javascript:alert(1)")).toBe("invalid");
    expect(parseUrlKind("file:///C:/Windows")).toBe("invalid");
  });

  it("accepts schemeless www", () => {
    expect(parseUrlKind("www.youtube.com/watch?v=1")).toBe("video");
  });

  it("matches subdomains", () => {
    expect(parseUrlKind("https://m.youtube.com/watch?v=1")).toBe("video");
    expect(parseUrlKind("https://music.youtube.com/watch?v=1")).toBe("video");
    // but not fake domains ending with the name
    expect(parseUrlKind("https://notyoutube.com/watch")).toBe("file");
  });
});

describe("splitBatchInput", () => {
  it("splits by newlines and trims", () => {
    expect(splitBatchInput("https://a.org/1\nhttps://b.org/2\n")).toEqual([
      "https://a.org/1",
      "https://b.org/2",
    ]);
  });

  it("skips comments and empties", () => {
    expect(splitBatchInput("# header\n\nhttps://a.org/1")).toEqual(["https://a.org/1"]);
  });
});

describe("extractFirstUrl", () => {
  it("finds a url inside arbitrary text", () => {
    expect(extractFirstUrl('check this https://youtu.be/x?t=1 "now"')).toBe(
      "https://youtu.be/x?t=1",
    );
  });

  it("finds magnet links", () => {
    expect(extractFirstUrl("magnet:?xt=urn:btih:abc&dn=test")).toBe("magnet:?xt=urn:btih:abc&dn=test");
  });

  it("returns null without urls", () => {
    expect(extractFirstUrl("no links here")).toBeNull();
  });
});
