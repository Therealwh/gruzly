## What & why

<!-- conventional commit title, e.g. feat: playlist offline queue -->

## Checklist
- [ ] `tsc` / `eslint` / `vitest` green
- [ ] `cargo fmt` / `clippy -D warnings` / `cargo test` green
- [ ] UI changes verified in **both themes** and **both languages**
- [ ] No hardcoded UI strings (i18next keys in ru.json + en.json)
- [ ] Engine argv inputs validated Rust-side; no secrets in logs
