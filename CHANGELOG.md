# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0-alpha.1] - 2026-10-19

First public pre-release. Expect rough edges: please report bugs.

### Added
- Clipboard capture of text, HTML, RTF, images and copied files, with every format stored per clip.
- Duplicate handling, maximum entries, expiry in days, maximum clip size.
- Search by text, wildcard or regular expression with match highlighting.
- Global hotkey (`Ctrl+Alt+V`), popup at the text cursor, paste back into the previous app.
- Paste as plain text, paste special transforms, multi-paste with separator, `Ctrl+1…0` quick paste.
- **Edit in place** for text clips.
- **Colored labels** with multiple assignment and quick filter (`Alt+1…8`).
- **Pins** that are never removed by automatic cleanup.
- Copy buffers (three slots with global hotkeys).
- Per-clip quick name and global hotkey.
- Application exclusion list and support for the "exclude from clipboard history" flag used by password managers.
- Encrypted LAN sync (AES-256-GCM, shared password), off by default.
- JSON export/import, SQLite backup/restore, compact, delete unused.
- Light and dark themes following Windows, settings window, tray icon, start with Windows.
- Unit tests and an end-to-end suite running against the real clipboard.

### Known limitations
- Italian-only interface.
- No diff, QR code, translate or email actions.
- Pasting into apps running as administrator is not supported.
- Executable is not code-signed.

[1.0.0-alpha.1]: https://github.com/Axeru19/crispboard/releases/tag/v1.0.0-alpha.1
