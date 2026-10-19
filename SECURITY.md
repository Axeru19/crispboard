# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub: **Security → Report a vulnerability** on
<https://github.com/Axeru19/crispboard/security/advisories/new>.

Include what you found, how to reproduce it, the affected version and the impact you see. You will get a first answer within about a week. Once a fix is released the report can be disclosed, with credit if you want it.

## Scope and threat model

In scope:

- the LAN sync protocol (`src/main/sync.js`, `src/main/synccrypto.js`)
- the renderer/main boundary (IPC allow-list, sandbox, context isolation)
- import of JSON export files
- handling of clipboard data that should have been excluded (password managers, excluded apps)

Known and by design:

- The history database is **not encrypted**. Anyone with access to your Windows profile can read it. Use the application exclusion list for sensitive tools.
- LAN sync trusts holders of the shared password. Use a strong password and trusted networks only.
