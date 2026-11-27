// Writes STATUS.md from the outcome of check-release.mjs.
// Runs in the Health workflow after the check step (always()).

import { writeFileSync } from "node:fs";

const result = (process.env.RESULT || "failure").toLowerCase();
const version = process.env.VERSION || "unknown";
const repo = process.env.GITHUB_REPOSITORY || "Therealwh/gruzly";
const runId = process.env.GITHUB_RUN_ID || "";
const now = new Date();
const iso = now.toISOString();
const human = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const passed = result === "success";
const runUrl = runId ? `https://github.com/${repo}/actions/runs/${runId}` : `https://github.com/${repo}/actions/workflows/health.yml`;

const summary = passed
  ? "the latest release is published, carries every expected asset, serves a" +
    " signed `latest.json` for all platforms, answers on the updater endpoint," +
    " and the Windows installer downloads."
  : "at least one release check failed. Open the workflow run for the exact" +
    " failing step before shipping an update.";

const content = `<!-- health result=${result} version=${version} checked=${iso} -->
# Release health

**${passed ? "Passing" : "Failing"}** — last checked ${human} on release ${version}.

| | |
|---|---|
| Result | ${passed ? "✅ Passing" : "❌ Failing"} |
| Release | ${version} |
| Last check | ${human} |
| Workflow run | [Actions](${runUrl}) |

Checked every hour by [Health](https://github.com/${repo}/actions/workflows/health.yml):
${summary}

This file is generated — edit the workflow or \`scripts/check-release.mjs\`
instead of changing it by hand.
`;

writeFileSync("STATUS.md", content, "utf-8");
console.log(`status written: ${passed ? "passing" : "failing"}, ${human}, ${version}`);