# Browser Clipper Protocol Version 3

Writes use:

```text
obsidian://fjg-task-clipper?payload=<base64url-json>
```

Actions:

- `create-tasks`
- `append-update`

Every request has a stable `request_id`. Create payloads contain `items[]`. Update payloads contain the explicitly selected `task_id`.

Version 2 `create-task-note` and `append-update` payloads are normalized during the compatibility window.
