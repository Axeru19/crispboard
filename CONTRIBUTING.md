# Contributing to Crispboard

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- Search the [issues](https://github.com/Axeru19/crispboard/issues) first.
- For anything bigger than a small fix, open an issue to discuss it before writing code.
- Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Windows 10/11 x64 and Node.js 24 or newer.

```powershell
git clone https://github.com/Axeru19/crispboard.git
cd crispboard
npm install
npm start
```

Use a throwaway database while developing so you do not touch your real history:

```powershell
$env:CRISPBOARD_DATA_DIR = "$env:TEMP\crispboard-dev"
node scripts/seed-demo.js $env:CRISPBOARD_DATA_DIR   # optional demo data
npm start
```

## Checks

```powershell
npm test      # must pass
npm run e2e   # drives the real clipboard and focus: run it on an idle PC (~2 min)
```

CI runs `npm test` on every push and pull request. Add a unit test for logic in `src/main` (database, transforms, sync crypto, import/export). Add an e2e step in `scripts/e2e.mjs` for behaviour that needs the real clipboard or keyboard.

## Code guidelines

- Match the surrounding style: CommonJS in `src/main`, ES modules in `src/renderer`, no bundler, no UI framework.
- Keep the renderer free of Node access. New IPC channels go in the allow-list in `src/main/preload.js` and are handled in `src/main/ipc.js`.
- Anything that talks to the Windows clipboard goes through `src/main/clipnative.js`.
- UI changes follow [`docs/design-system.md`](docs/design-system.md): use the CSS tokens, keep both light and dark themes working, keep everything reachable from the keyboard, respect `prefers-reduced-motion`.
- User-visible strings are currently Italian. If you add a string, keep it short and consistent with the existing ones.
- Keep dependencies to a minimum and justify any new one in the pull request.

## Pull requests

1. Fork and create a branch from `main`.
2. Keep the change focused; unrelated cleanups belong in separate PRs.
3. Update `README.md`, `CHANGELOG.md` and the parity matrix in `docs/ditto-analysis.md` when behaviour changes.
4. For UI changes, attach before/after screenshots (`node scripts/screenshots.mjs` regenerates `docs/img`).
5. Make sure `npm test` passes.

## Clean-room note

Crispboard is inspired by [Ditto](https://github.com/sabrogden/Ditto) (GPL-3.0) but must not contain Ditto source code. Do not copy code from Ditto or from other projects with incompatible licenses. Describe behaviour in your own words and write the implementation yourself.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
