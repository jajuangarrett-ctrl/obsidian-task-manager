# Objective Manager 0.28.4 runtime recovery snapshot

This directory preserves the installed 0.28.4 runtime, including the targeted
Completed-view filter correction verified in Obsidian on 2026-10-28. The fix
excludes records whose saved status is archived, while retaining records saved
as completed even when they have earlier archive history. It also retains the
0.28.4 refresh and in-place status-change implementation.

This is a runtime snapshot, not a source release. The repository source at the
parent commit is 0.28.3 and does not build this runtime. Do not rebuild, publish,
or install the older root artifacts over this snapshot. Recover the matching
0.28.4 source, reconcile the filter change in source, and run the full project
checks and packaging before merging a source update or publishing a release.

No vault data or plugin settings are included.

SHA-256:

- `main.js`: `69dc9833e42b1717318de0589a58dfc5a1e75b39edc6ef4c3369b7e2a80445a4`
- `manifest.json`: `5e6c785cbf4f38cdba1d32a06facad7cdd59eda0a6dab5c7c80ce82d34f4bbb0`
- `styles.css`: `82457354429bfe4f46960dc8fc0fbf1dc2dbc245c4c12db10c85d83acb5e067a`
