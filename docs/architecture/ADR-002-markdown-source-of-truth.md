# ADR-002: Markdown Source of Truth

Status: Accepted
Date: 2026-07-27

## Decision

Each task is a folder containing `task.md`, `updates.md`, attachments, and optional related files. Markdown files are authoritative. The dashboard and task catalog are derived indexes.

Active workspaces live in `08 Tasks/Workspaces/`. Archived workspaces move to `08 Tasks/Archive/`.

## Consequences

- Tasks remain readable without the plugin.
- Stable task IDs are required because folder titles and locations can change.
- Archive and reopen operations must preserve links and roll back on failure.
