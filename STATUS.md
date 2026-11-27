<!-- health result=unknown version=unknown checked=1970-01-01T00:00:00Z -->
# Release health

**Waiting for the first check** — this file is rewritten by the hourly
[Health](https://github.com/Therealwh/gruzly/actions/workflows/health.yml)
workflow. It verifies that the latest release is published, carries every
expected asset, serves a signed `latest.json`, answers on the updater endpoint
and downloads the Windows installer.
