# Focus Lists Home browser QA

Run `node scripts/qa/focus-home/run.mjs` from the repository with Playwright and Chromium already installed. Optionally set `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` and `SCREENSHOT_DIR` (see the Objectives App fixture for an example).

This runs the real dashboard, Focus Home and production CSS with synthetic data, a mock Obsidian host, and local-only network access. Checks: Home/All routing, folded/landscape/portrait layouts, active-page preservation, Sidebar/Single, touch targets, inline checklist, planning date versus deadline, Undo, Quick Entry during constrained height, and long converted titles and action labels in folded, unfolded, narrow split, and desktop-width panes. It does not authenticate, modify a vault, or simulate real iOS hinge events and the native keyboard.
