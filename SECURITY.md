# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Open a private report via [GitHub Security Advisories](https://github.com/Therealwh/gruzly/security/advisories/new)
("Report a vulnerability"). Include:

- the affected component (frontend, Rust core, aria2/ytdlp integration, installer);
- reproduction steps or a proof of concept;
- the impact you believe it enables.

You will get a response within 72 hours. If the issue is confirmed, a fix will
be released and you will be credited in the changelog (unless you prefer to
stay anonymous).

## Scope

In scope: the desktop app (frontend and Rust core), the bundling/updating of
the yt-dlp / aria2 / ffmpeg sidecars, and the local aria2 RPC channel.

Out of scope: vulnerabilities in the bundled third-party engines themselves —
please report those upstream ([yt-dlp](https://github.com/yt-dlp/yt-dlp/security),
[aria2](https://github.com/aria2/aria2/security), [FFmpeg](https://ffmpeg.org/security.html)).

## Design notes

- All engine arguments are validated in Rust (URL schemes, magnet prefixes,
  browser allowlist, output templates) — see [SECURITY_REVIEW.md](SECURITY_REVIEW.md).
- The aria2 RPC secret is generated per launch, stays in memory, and is never
  logged.
- The webview CSP restricts frame origins to the preview embed allowlist.
