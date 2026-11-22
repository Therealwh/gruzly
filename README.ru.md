<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <img alt="Gruzly" src=".github/assets/banner-light.svg" width="100%">
  </picture>

  <p><strong>Файлы, торренты и видео с 1000+ сайтов.<br>Предпросмотр перед скачиванием.</strong></p>

  [🇬🇧 English](README.md) • [🇷🇺 Русский](README.ru.md)
</div>

---

[![Release](https://img.shields.io/github/v/release/Therealwh/gruzly?style=for-the-badge&logo=github&color=0ea5e9)](https://github.com/Therealwh/gruzly/releases)
[![Downloads](https://img.shields.io/github/downloads/Therealwh/gruzly/total?style=for-the-badge&logo=github&color=10b981)](https://github.com/Therealwh/gruzly/releases)
[![Stars](https://img.shields.io/github/stars/Therealwh/gruzly?style=for-the-badge&logo=github&color=f472b6)](https://github.com/Therealwh/gruzly/stargazers)
[![License](https://img.shields.io/github/license/Therealwh/gruzly?style=for-the-badge&color=8b5cf6)](LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/Therealwh/gruzly/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI&color=0ea5e9)](https://github.com/Therealwh/gruzly/actions)
![Windows](https://img.shields.io/badge/Windows-10%2B-0ea5e9?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-12%2B-8b5cf6?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-x64%20%7C%20arm64-10b981?style=for-the-badge&logo=linux&logoColor=white)

## Содержание

- [Чем отличается](#-чем-отличается)
- [Скриншоты](#-скриншоты)
- [Установка](#-установка)
- [Быстрый старт](#-быстрый-старт)
- [Предпросмотр видео](#-предпросмотр-видео)
- [Сравнение с другими](#-сравнение-с-другими)
- [Архитектура](#-архитектура)
- [Горячие клавиши](#%EF%B8%8F-горячие-клавиши)
- [План](#-план)
- [Участие](#-участие)
- [Правовая информация](#%EF%B8%8F-правовая-информация)
- [Благодарности](#-благодарности)
- [Лицензия](#-лицензия)

## ✨ Чем отличается

- **Посмотрите, прежде чем тратить трафик.** Вставьте ссылку → встроенный
  плеер и таблица форматов (качество, fps, кодек, размер, HDR). Выберите
  «Лучшее», «1080p», «720p» или «Только аудио» — и скачивайте.
- **Единая очередь для всего.** Видео, прямые файлы, magnet и `.torrent`
  живут в одном списке с живым прогрессом, паузой/продолжением и повтором.
- **Настоящие движки, тонкая оболочка.** yt-dlp, aria2 (до 16 соединений на
  файл) и FFmpeg делают тяжёлую работу; оболочка Rust/Tauri не мешает.
- **Самолечение.** yt-dlp обновляется при каждом запуске — экстракторы
  сайтов ломаются регулярно, приложение поспевает.
- **Обе темы, оба языка.** Тёмная и светлая спроектированы, а не «инвертированы»;
  русский и английский полные, плюрализация через `Intl`.

## 📸 Скриншоты

| Тёмная | Светлая |
|---|---|
| ![Главная, тёмная тема](.github/assets/screenshot-dark-en.png) | ![Главная, светлая тема](.github/assets/screenshot-light-en.png) |
| ![Предпросмотр видео, тёмная тема](.github/assets/screenshot-dark-ru.png) | ![Раздел видео, светлая тема](.github/assets/screenshot-light-en-video.png) |

## 🚀 Установка

Скачайте свежую сборку из
[Releases](https://github.com/Therealwh/gruzly/releases) — yt-dlp, aria2 и
FFmpeg уже внутри, ничего доустанавливать не нужно:

| Файл | Что это |
|---|---|
| `Gruzly_<ver>_x64-setup.exe` | Установщик Windows (NSIS) |
| `Gruzly_<ver>_x64_en-US.msi` | MSI для тихого развёртывания |
| `Gruzly-portable-win64.zip` | Portable — распаковать и запустить `Gruzly.exe` |
| `Gruzly_<ver>_amd64.deb` / `.AppImage` | Linux (deb ставит `aria2` из репозиториев) |
| `Gruzly_aarch64.app.tar.gz` | macOS (Apple Silicon) |

Windows 10+ получает WebView2 автоматически. macOS/Linux-сборки идут из CI.

## ⚡ Быстрый старт

1. **Установите и запустите** — приложение откроется на Главной.
2. **Вставьте любую ссылку** в быстрое поле — видео откроет предпросмотр,
   файлы и magnet уйдут прямо в очередь.
3. **Выберите качество и нажмите Скачать** — прогресс, скорость и ETA появятся
   в очереди; правый клик — открыть папку / повторить.

## 🎬 Предпросмотр видео

Киллер-фича: сначала анализ, скачивание — после вашего решения. В модальном
окне — встроенный плеер (YouTube, Rutube, VK, OK, Bilibili), полная таблица
форматов с примерными размерами и HDR-бейджами, пресеты в один клик, выбор
субтитров и плейлист с чекбоксами по роликам.

![Предпросмотр видео, тёмная тема](.github/assets/screenshot-dark-ru.png)

## 🆚 Сравнение с другими

| | Gruzly | IDM | JDownloader 2 | yt-dlp (CLI) | Браузер |
|---|---|---|---|---|---|
| Цена | Бесплатно, MIT | $25 навсегда | Бесплатно | Бесплатно | Бесплатно |
| Размер | ~80 МБ | ~15 МБ | Java, тяжёлый | только CLI | — |
| Торренты | ✓ | ✗ | ✓ | ✗ | ✗ |
| Видео, 1000+ сайтов | ✓ | частично | ✓ | ✓ | ✗ |
| Предпросмотр до скачивания | ✓ | ✗ | ✗ | ✗ | — |
| Многопоточная докачка | ✓ (16) | ✓ | ✓ | ограничено | ✗ |
| Тёмная и светлая темы | ✓ | ✗ | ✗ | — | — |
| Интерфейс RU и EN | ✓ | частично | ✓ | — | ✓ |

Где конкуренты всё ещё сильнее: у IDM двадцать лет доводки браузерных
расширений; краулер JDownloader покрывает больше исключительных случаев.
Gruzly молодой и быстро развивается.

## 🏗 Архитектура

```mermaid
flowchart LR
    UI["React + TS frontend"] -->|invoke| CORE["Rust orchestrator<br/>(Tauri 2)"]
    CORE -->|events ≤4/s| UI
    CORE --> YT["yt-dlp sidecar"]
    CORE --> AR["aria2c sidecar"]
    CORE --> FF["FFmpeg sidecar"]
    YT -->|"JSON analysis<br/>%(progress)j"| CORE
    AR -->|"JSON-RPC<br/>127.0.0.1"| CORE
    FF -->|"mux video+audio<br/>mp3 / m4a"| CORE
    DB[(SQLite history)] --- CORE
```

Аргументы движков валидируются в Rust и всегда передаются массивами argv —
подробное ревью в [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## ⌨️ Горячие клавиши

| Сочетание | Действие |
|---|---|
| `Ctrl+K` | Палитра команд |
| `Ctrl+V` | Вставить и проанализировать ссылку |
| `Ctrl+1…8` | Перейти в раздел |
| `Ctrl+Shift+L` | Переключить тему |

Все сочетания переназначаются в Настройки → Горячие клавиши.

## 🗺 План

- [x] Анализ видео → предпросмотр → скачивание (v0.1.0)
- [x] Файлы и торренты через aria2 с выбором файлов раздачи (v0.1.0)
- [x] Подписанные само-обновления (v0.1.1)
- [x] Фиксы aria2 по результатам полевых тестов (v0.1.2)
- [ ] Меню трея и сворачивание в трей
- [ ] Приоритеты очереди drag-and-drop
- [ ] Авто-применение пресетов по домену
- [ ] Браузерное расширение: перехват ссылок на видео
- [ ] CLI `gruzly <url>`
- [ ] Пульт с телефона: отправь ссылку — скачается дома

## 🤝 Участие

PR приветствуется — гейты и конвенции в [CONTRIBUTING.md](CONTRIBUTING.md).
Хорошие первые задачи помечены `good first issue`.

<a href="https://github.com/Therealwh/gruzly/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Therealwh/gruzly" alt="Участники">
</a>

## ⚠️ Правовая информация

Скачивайте только тот контент, права на который у вас есть. Gruzly не
поддерживает и не обходит DRM или иные технологии защиты копирайта. Уважайте
авторские права и правила сервисов.

## 🙏 Благодарности

Gruzly — тонкая оболочка над проверенными проектами:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — извлечение с сайтов
- [aria2](https://github.com/aria2/aria2) — движок HTTP/FTP/торрентов
- [FFmpeg](https://ffmpeg.org) — склейка и извлечение аудио
- [Tauri](https://v2.tauri.app) — нативная оболочка
- [Radix UI](https://www.radix-ui.com) / [Tailwind CSS](https://tailwindcss.com) — UI-примитивы

## 📄 Лицензия

[MIT](LICENSE). Бандленные движки сохраняют свои лицензии (yt-dlp: Unlicense,
aria2: GPL-2.0, FFmpeg: LGPL-2.1+) и распространяются без изменений.

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Therealwh/gruzly&type=Date)](https://star-history.com/#Therealwh/gruzly&Date)
