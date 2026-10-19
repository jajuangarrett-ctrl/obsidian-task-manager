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

## People associations (0.23.2)

Create items accept optional `people: string[]`. Names are trimmed, whitespace-normalized, and deduplicated without case sensitivity. Version 2 `create-task-note` payloads also preserve `people`. Missing People means unassigned; legacy `project` fields retain their original meaning. Browser capture leaves agenda inclusion off.

The authenticated, read-only `GET /people` catalog returns `{ "people": ["Alex Rivera", "Sam Lee"] }`, using the same roster and objective associations as Objective Manager's People picker. Existing origin, loopback, token, and rate limits apply.
