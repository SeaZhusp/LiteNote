<!-- markdownlint-disable -->

<div align="center">

<img src="./src-tauri/icons/icon.png" width="120" alt="LiteNote Icon">

# LiteNote

Lightweight, customizable local to-do desktop widget<br>
Built with Tauri 2 + React

[Issues](https://github.com/SeaZhusp/LiteNote/issues) · [Releases](https://github.com/SeaZhusp/LiteNote/releases)


[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![React 19](https://img.shields.io/badge/React-19-blue?logo=react)
![Tauri v2](https://img.shields.io/badge/Tauri-v2-%2324C8D8?logo=tauri)
![Rust Edition 2021](https://img.shields.io/badge/Rust-2021-%23000000?logo=rust)

</div>

---

## Why LiteNote

Many to-do and note-taking tools are feature-packed and heavy — not ideal for a sticky-on-desktop quick-capture widget. LiteNote focuses on **local to-do** management: borderless transparent panel, system tray resident, instant toggle with a hotkey. Your data stays on your machine by default, with optional WebDAV sync.

## Features

- **Local To-Dos** — SQLite storage with create/edit/complete/delete, pin, four priority colors, due dates, and drag-to-reorder; stored locally by default

- **Notes & Progress** — Attach a note and 0–100% progress to each task; progress is shown right in the list

- **Recurring Tasks** — Daily / weekly (multi-select weekdays) / monthly (multi-select dates) repeats with customizable time; auto-advances to the next cycle

- **Due Date Reminders** — Customizable lead time (1–1440 minutes); choose a top-right popup (non-intrusive, with Snooze / Got it) or a system notification

- **Week Calendar** — Mon–Sun calendar bar at the top; switch weeks, click a day to filter tasks. Red dot = due tasks, orange dot = overdue

- **Drag-to-Date** — Drag a to-do onto a calendar cell to set its due date instantly; also copy a to-do to another date

- **Focus Mode** — A minimal floating window with only your task list; toggle between Focus and Full mode anytime

- **Desktop Widget Experience** — Borderless frosted glass, adjustable opacity, custom background image, always-on-top, window lock to prevent accidental dragging, hide to system tray

- **Clock & Lunar Date** — Large clock with lunar date, date, and weekday; collapsible

- **Multiple Themes** — Choose from Glass, Dark, or Light themes; switch instantly

- **Customizable Hotkeys** — Toggle window, focus mode, and always-on-top are all rebindable (defaults: `Ctrl+Shift+L` / `Ctrl+Shift+F` / `Ctrl+Shift+P`, `⌘` on macOS)

- **WebDAV Sync** — Built-in Jianguoyun preset; background two-way merge every 5 minutes (last-write-wins by update time), plus force upload and restore from cloud

- **Export** — One-click export to a txt file, split into pending and completed sections

- **Inline Settings** — General (opacity, background, reminder mode & lead time, theme, language, autostart), Shortcuts, and Sync tabs, all inside the main window

- **Cross-Platform** — Windows (NSIS installer + portable) and macOS (`.app` / `.dmg`)

<p align="center">
  <img src="docs/images/main.png" width="32%" alt="Main window">&nbsp;
  <img src="docs/images/maoboli.png" width="32%" alt="Glass effect">&nbsp;
  <img src="docs/images/qianse.png" width="32%" alt="Light theme">&nbsp;
</p>

## Use Cases

- Lightweight to-do list that lives on your desktop
- Quick capture while gaming, watching videos, or working, or stay focused with Focus mode
- Periodic reminders (drink water, weekly meetings, monthly bills, etc.)
- Time-sensitive task reminders (popup or system notification)
- Multi-device tasks synced through Jianguoyun (WebDAV)

## Installation

Download the latest version from [GitHub Releases](https://github.com/SeaZhusp/LiteNote/releases).

> **Windows users:** Some enterprise/LTSC editions of Windows 10 may lack WebView2 Runtime. The installer bundles a bootstrapper to install it automatically. If issues persist, manually install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ & [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) stable
- [Tauri CLI 2](https://v2.tauri.app/)

**Windows additional:** Microsoft C++ Build Tools (MSVC) + Windows SDK

**macOS additional:** Xcode Command Line Tools

### Steps

```bash
git clone https://github.com/SeaZhusp/LiteNote.git
cd LiteNote

pnpm install

# Development (Tauri + hot-reload)
pnpm tauri dev

# Frontend only (no Tauri APIs)
pnpm dev
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=SeaZhusp/LiteNote&type=Date&legend=top-left)](https://star-history.com/#SeaZhusp/LiteNote&Date)

## Contributing

Issues and pull requests are welcome! Please submit via [GitHub Issues](https://github.com/SeaZhusp/LiteNote/issues).

## License

This project is licensed under the [MIT License](LICENSE).
