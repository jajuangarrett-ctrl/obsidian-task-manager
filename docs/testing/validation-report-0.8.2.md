# FJG Task Manager v0.8.2 Validation

Date: 2026-07-28

## Scope

Validated natural-height Recent Updates cards, complete update-content
visibility, and task-card separation on the native Obsidian dashboard.

## Automated validation

- TypeScript type checking passed.
- Thirteen test files passed.
- Fifty-eight tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task
  CLI, and migration tool.
- Release packaging completed with BRAT-compatible root files and both ZIP
  artifacts.

## Live Obsidian validation

- Installed FJG Task Manager v0.8.2 into the canonical FJG Vault and reloaded
  Obsidian.
- Opened the live Delegated view containing `Immediate CalWORKs Termination of
  Work Study student`.
- Confirmed the update title, `Jul 28, 2026 · Franklin`, and `Status changed
  from do-first to delegate.` are all visible inside the update panel.
- Confirmed the update panel remains inside its task card.
- Confirmed `Onboarding and Initial Meetings — CalWORKs` begins below the
  completed task boundary without overlap.
- Confirmed the update card remains clickable through its full visible area.

## Result

Pass. FJG Task Manager v0.8.2 displays complete Recent Updates content without
clipping or covering adjacent tasks.
