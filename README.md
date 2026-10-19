<div align="center">

<img src="assets/icon.png" alt="Crispboard" width="96" height="96">

# Crispboard

**A fast, keyboard-first clipboard manager for Windows.**
Everything you copy, one hotkey away. Search it, edit it, label it, pin it, paste it.

[![CI](https://github.com/Axeru19/crispboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Axeru19/crispboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-3ddc97.svg)](LICENSE)
![Platform: Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-3b3b3b.svg)

[Download](https://github.com/Axeru19/crispboard/releases) · [Italiano](README.it.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

<img src="docs/img/popup-dark.png" alt="Crispboard popup, dark theme" width="720">

</div>

---

> **Alpha.** Crispboard is in early alpha: it works day to day in our tests, but expect bugs and breaking changes. Back up your history (Settings → Dati) before updating, and please [report issues](https://github.com/Axeru19/crispboard/issues).

## Why Crispboard

Crispboard rebuilds the core of [Ditto](https://github.com/sabrogden/Ditto), the long-running Windows clipboard manager, with a modern interface and three things Ditto does not have:

| | |
|---|---|
| **Edit in place** | Fix a clip right in the preview pane. No external editor, save with `Ctrl+Enter`, cancel with `Esc`. |
| **Colored labels** | Organize clips with colored labels. A clip can have several. Filter with one click or `Alt+1…8`. |
| **Pins that stay** | Pinned clips sit at the top and are **never** removed by the history limit, the expiry or "delete unused". |

<p align="center">
  <img src="docs/img/edit-dark.png" alt="In-place editing" width="49%">
  <img src="docs/img/labels-dark.png" alt="Label filter" width="49%">
</p>

## Features

- **Captures everything**: text, HTML, RTF, images, copied files. Every format is stored, so pasting keeps formatting.
- **Instant search**: plain text, wildcards (`*`, `?`) or regular expressions, with highlighted matches.
- **One global hotkey** (`Ctrl+Alt+V` by default). The window opens next to your text cursor and pastes back into the app you were using.
- **Keyboard first**: arrows to move, `Enter` to paste, `Shift+Enter` for plain text, `Ctrl+1…0` to paste the first ten clips directly.
- **Paste special**: UPPER, lower, Capitalize, Sentence, camelCase, slug, one line, trim, ASCII only, add time and more.
- **Multi-paste**: select several clips and paste them with a configurable separator.
- **Copy buffers**: three independent slots with their own global copy, cut and paste hotkeys.
- **Privacy**: skips content flagged as private by password managers, and has an app exclusion list (KeePass, 1Password, Bitwarden, LastPass and Dashlane out of the box). Pause capture anytime from the tray.
- **LAN sync**: push clips to other PCs on your network. End-to-end encrypted (AES-256-GCM) with a shared password. Off by default.
- **History control**: maximum entries, expiry in days, duplicate handling, maximum clip size.
- **Backup, export, import**: JSON export with labels and pins, SQLite backup and restore.
- **Light and dark**: follows Windows, or choose.
- **Light on the system**: starts hidden in the tray, no GPU process, opens instantly.

<p align="center">
  <img src="docs/img/popup-light.png" alt="Light theme" width="49%">
  <img src="docs/img/settings-labels-dark.png" alt="Settings" width="49%">
</p>

## Install

### Installer (recommended)

1. Download `Crispboard-Setup-<version>.exe` from the [releases page](https://github.com/Axeru19/crispboard/releases).
2. Run it. It installs for your user only (no administrator rights), adds a Start menu shortcut and starts Crispboard.
3. Press `Ctrl+Alt+V`.

Uninstall from *Settings → Apps*. Your history in `%APPDATA%\Crispboard` is kept.

### Portable

Download `Crispboard-win-x64.zip`, unzip anywhere and run `Crispboard.exe`.

The installer and executable are not code-signed yet, so Windows SmartScreen may warn on first launch (*More info → Run anyway*). Turn on *Start with Windows* in Settings if you want it always available.

### Build from source

Requirements: Windows 10/11 x64 and [Node.js](https://nodejs.org) 24 or newer.

```powershell
git clone https://github.com/Axeru19/crispboard.git
cd crispboard
npm install
npm start               # run in development
npm run dist            # installer in dist\ and portable build in dist\win-unpacked
```

## Keyboard reference

| Action | Keys |
|---|---|
| Open / close | `Ctrl+Alt+V` (configurable) |
| Move | `↑` `↓` `PgUp` `PgDn` |
| Paste | `Enter`, double click, `Ctrl+1…9,0` for the first ten |
| Paste as plain text | `Shift+Enter` |
| Paste special | right click → *Incolla speciale* |
| Search | just type · modes: Text / Wildcard / Regex |
| Edit in place | `Ctrl+E` or `F2` · save `Ctrl+Enter` · cancel `Esc` |
| Pin / unpin | `Ctrl+P` |
| Labels | `Ctrl+L` (type to filter or create) · filter `Alt+1…8` |
| Reorder | `Alt+↑` `Alt+↓` |
| Delete | `Ctrl+D` or `Del` |
| New clip | `Ctrl+N` |
| Multi-select | `Shift+↑/↓`, `Ctrl+click` |
| Toggle preview | `F3` |
| Settings | `Ctrl+,` |

> The interface is currently in Italian. English localization is on the [roadmap](#roadmap), contributions welcome.

## Privacy and security

- Everything stays on your machine, in `%APPDATA%\Crispboard\crispboard.db` (SQLite). **History is stored unencrypted**, like Ditto. Use the app exclusion list for sensitive tools.
- No telemetry, no network access unless you enable LAN sync.
- LAN sync listens on a TCP port (default 23443) only when enabled, and drops anything not encrypted with your shared password. Only use it on networks you trust.
- The UI runs in a sandboxed renderer with context isolation and an allow-list of IPC channels.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## How it works

Electron shell, SQLite via Node's built-in `node:sqlite`, and direct Win32 calls through [koffi](https://koffi.dev) for the clipboard, text-cursor position, focus restore and synthesized key presses. No framework in the renderer: plain JS and CSS tokens in OKLCH.

Electron 44 made its clipboard API asynchronous and removed arbitrary formats, so Crispboard reads and writes the Windows clipboard directly (`CF_UNICODETEXT`, `HTML Format`, `Rich Text Format`, `PNG`, `CF_DIB`, `CF_HDROP`).

More: [`docs/design-system.md`](docs/design-system.md) · [`docs/ditto-analysis.md`](docs/ditto-analysis.md) (feature analysis and parity matrix against Ditto).

## Development

```powershell
npm test         # unit tests (database, search, retention, import/export, transforms, crypto)
npm run e2e      # end-to-end on the real app: real clipboard, real pastes
npm run icons    # regenerate src/renderer/icons.js from Phosphor
node scripts/screenshots.mjs   # regenerate docs/img
```

`npm run e2e` drives the real clipboard and keyboard focus. Run it on an idle machine; it takes about two minutes.

Project layout:

```
src/main/       main process: db, clipboard watcher, win32, paste, hotkeys, tray, sync
src/renderer/   popup and settings UI (no build step)
scripts/        icon generation, demo data, screenshots, e2e
docs/           analysis, design system, screenshots
```

## Roadmap

Not done yet (PRs welcome):

- [ ] English (and other) localization
- [ ] Diff between two clips
- [ ] QR code / translate / email actions
- [ ] Import Ditto themes and database
- [ ] Rebindable in-popup shortcuts
- [ ] Code signing and a winget package
- [ ] Pasting into apps running as administrator

Known limits: Electron's memory footprint (a few hundred MB working set versus tens of MB for Ditto), palette-based (1/4/8-bit) bitmaps are not captured unless a PNG format is also on the clipboard, and clips over 300,000 characters cannot be edited in place.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Credits and license

[MIT](LICENSE) © Axel Liuzzi.

Crispboard is an independent project **inspired by Ditto** by Scott Brogden. It is not affiliated with Ditto and contains none of its code: Ditto's behavior was studied from its documented features, data schema and resource files to define the feature set.

Built with [Electron](https://www.electronjs.org) (MIT), [koffi](https://koffi.dev) (MIT), [Phosphor Icons](https://phosphoricons.com) (MIT) and the [Geist](https://vercel.com/font) typeface (SIL OFL 1.1).
