# FJG Task Manager v0.8.1 Validation

Date: 2026-07-28

## Scope

Validated long task-title wrapping, title-callout sizing, metadata separation,
and action alignment on the native Obsidian dashboard.

## Automated validation

- TypeScript type checking passed.
- Thirteen test files passed.
- Fifty-eight tests passed.
- Production builds succeeded for the Obsidian plugin, Chrome clipper, task
  CLI, and migration tool.
- Release packaging completed with BRAT-compatible root files and both ZIP
  artifacts.

## Live Obsidian validation

- Installed FJG Task Manager v0.8.1 into the canonical FJG Vault and reloaded
  Obsidian.
- Compared the requested furniture task against the corrected live card.
- Compared the requested A2MEND task against the corrected live card.
- Confirmed the title control expands to contain every wrapped line.
- Confirmed the status badge and project remain below the title without
  overlap.
- Confirmed the status selector, Update, and Archive controls remain aligned
  with the top of the title.
- Confirmed Related files and Recent updates retain their existing spacing and
  functionality.

## Result

Pass. FJG Task Manager v0.8.1 keeps long task cards compact, readable, and
properly aligned.
