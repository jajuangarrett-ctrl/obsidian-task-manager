# FJG Task Manager v0.8.0 Validation

Date: 2026-07-28

## Scope

Validated task-workspace path copying from the Related files action row, desktop
absolute-path resolution, mobile vault-relative fallback, active-task command
registration, packaged runtime installation, and live Obsidian rendering.

## Automated validation

- TypeScript type checking passed.
- Thirteen test files passed.
- Fifty-eight tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task CLI,
  and migration tool.
- Path tests cover macOS, Windows, trailing desktop separators, and the mobile
  vault-relative fallback.

## Live Obsidian validation

- Installed FJG Task Manager v0.8.0 into the canonical FJG Vault and reloaded
  Obsidian.
- Confirmed **Copy path** renders between **Add file** and **Open folder** on the
  requested task card.
- Selected **Copy path** for `Purchase a swing outdoor for CalWorks — Sent an
  email to Anthony regarding next steps.`
- Confirmed the copied value was:
  `/Users/franklingarrett/FJG Vault/08 Tasks/Workspaces/Purchase a swing outdoor for CalWorks — Sent an email to Anthony regarding next steps.`
- Confirmed the action does not modify the task workspace or its files.

## Result

Pass. FJG Task Manager v0.8.0 is ready for direct task-folder path copying from
the dashboard.
