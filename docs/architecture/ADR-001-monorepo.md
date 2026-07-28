# ADR-001: Task Manager Monorepo

Status: Accepted
Date: 2026-07-27

## Decision

Maintain the Obsidian plugin, browser clipper, shared task core, protocol, migration tool, and task CLI in one GitHub repository named `obsidian-task-manager`.

## Consequences

- The schema and protocol have one implementation.
- Browser and plugin releases can be tested together.
- The legacy Obsidian and Taskboard clipper repositories remain unchanged until cutover.
