# Objectives App View: synthetic browser QA

This script bundles the production Objectives App View, its model, shared detail renderer and actual plugin CSS. Only the Obsidian host and in-memory indexed objectives are fixtures. It does **not** open Obsidian, read/write a real vault, call AI or install/update any plugin. Browser requests other than the temporary loopback fixture are blocked.

Run from the repository with dependencies installed and an already available compatible Playwright/Chromium:

```sh
PLAYWRIGHT_MODULE=/path/to/existing/node_modules/playwright \
SCREENSHOT_DIR=/tmp/objectives-app-qa \
node scripts/qa/objectives-app/run.mjs
```

Leave `PLAYWRIGHT_MODULE` unset if the existing installation resolves in this checkout. `SCREENSHOT_DIR` is optional. `CHROMIUM_PATH` can point to an already-installed Chromium supported by that Playwright version. The fixture opens an ephemeral local server and closes it with the browser.

Coverage: folded 390 px full foreground detail with restoration of focus, search, filter and list position; real 867 px side-by-side layout and reduced height modelling keyboard-constrained space; explicit scope/status choices; synthetic shortcut and canonical attachment routing; stale duplicate protection. This is not a physical-device, native keyboard, real Obsidian host or Live Voice session test.
