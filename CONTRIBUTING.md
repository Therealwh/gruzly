# Contributing to Gruzly

Thanks for your interest in the project!

1. Fork, then create a branch (`feat/…` or `fix/…`). Commit messages follow
   [Conventional Commits](https://www.conventionalcommits.org): `feat:`,
   `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
2. Make the gates green before pushing:

   ```bash
   npx tsc --noEmit && npx eslint . && npx vitest run
   cd src-tauri && cargo fmt --all -- --check \
     && cargo clippy --all-targets -- -D warnings && cargo test
   ```

3. Open a pull request. Describe what changed and why; screenshots for UI
   changes — in **both themes**.

## Project rules

- **No hardcoded UI strings.** Everything goes through i18next keys in
  `src/i18n/{en,ru}.json`, kept in sync.
- **Both themes are first-class.** Every screen must look right in dark and
  light; design tokens live in `src/index.css` as CSS variables.
- **Engine arguments are argv arrays, never shell strings.** Any new input
  that reaches argv must be validated in Rust (see SECURITY_REVIEW.md).
- Secrets and cookies never appear in logs.
- Parsers and validators need tests (yt-dlp JSON, aria2 status, URL routing).
- DRM is out of scope: PRs attempting to bypass protection will be rejected.

<details>
<summary>🇷🇺 Правила для русскоязычных контрибьюторов</summary>

1. Форк → ветка `feat/…` или `fix/…`; коммиты по Conventional Commits.
2. Гейты перед пушем: `tsc`, `eslint`, `vitest`, `cargo fmt/clippy/test` —
   всё зелёное.
3. В PR: что изменилось и зачем; для UI — скриншоты обеих тем.
4. Никаких захардкоженных строк интерфейса — только ключи i18next в обоих
   словарях (`en.json` и `ru.json` синхронны).
5. Аргументы движков — только массивами; новые входы в argv валидируются в Rust.
6. Cookies и секреты не попадают в логи.
7. DRM не обходится — такие PR отклоняются.

</details>
