# CI и релизы GitHub Actions

Здесь лежат готовые workflow-файлы:

- `ci.yml` — на каждый push в `main` и pull request: фронтенд (ubuntu:
  typecheck, lint, vitest, build) и Rust (windows: `cargo fmt`, `clippy -D
  warnings`, `cargo test`);
- `release.yml` — по тегу `v*` (и вручную): сборка MSI/NSIS/portable `.exe`,
  архива для друзей и мода-переводчика, публикация GitHub Release.

## Почему они лежат здесь, а не в `.github/workflows/`

Текущий токен GitHub CLI выдан без scope `workflow`, а GitHub не разрешает
создавать/обновлять файлы `.github/workflows/*` таким токеном. Включение —
одна команда и повторная авторизация в браузере:

```powershell
# 1. Добавить scope workflow (откроется браузер для подтверждения)
gh auth refresh -h github.com -s workflow

# 2. Скопировать workflow в репозиторий и запушить
New-Item -ItemType Directory -Force .github/workflows | Out-Null
Copy-Item docs/ci/*.yml .github/workflows/
git add .github/workflows
git commit -m "ci: enable GitHub Actions workflows"
git push
```

После этого:

- CI запустится на ближайший push/PR;
- релиз можно собрать тегом:
  ```powershell
  git tag v0.1.1
  git push origin v0.1.1
  ```
  workflow соберёт установщики и опубликует релиз на странице Releases.

## Локальная проверка тех же шагов

```powershell
pnpm check
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```
