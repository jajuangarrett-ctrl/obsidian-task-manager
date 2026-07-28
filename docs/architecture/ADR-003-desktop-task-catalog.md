# ADR-003: Desktop Read-Only Task Catalog

Status: Accepted
Date: 2026-07-27

## Decision

The desktop Obsidian plugin exposes an authenticated, loopback-only, read-only task catalog for live Chrome search. The catalog returns bounded task identity fields and has no write endpoints.

Task creation and updates continue through versioned `obsidian://fjg-task-clipper` payloads.

## Consequences

- Chrome can search by title, ID, project, status, and delegated person.
- Obsidian Mobile and task creation do not depend on the catalog.
- Recent-task and manual-ID fallbacks remain necessary.
