# People and agenda objectives

People are explicit employee display names stored in an objective's `people` list. The People picker offers individual names from the existing Agenda Items roster and previously associated names; users can add an exact display name. Team and Program roster entries are excluded from suggestions. Existing project fields and tags are preserved. Association never moves the objective, changes its ID, or changes delegation.

Choose **Show on agendas** in People to publish the open objective for every associated employee. Association alone does not publish it. The plugin writes `05 People/Agenda Items/_objectives.json` only where that existing agenda folder is present. Refresh the Objective Manager if changes were made outside Obsidian. Completed, archived, deselected, and unassociated objectives are excluded. The snapshot stores only title, ID, people, status, due, priority, and vault-relative note path, not objective body or attachments.

The synchronized Agenda Center runtime is `Artifacts/Agenda Dashboard/agenda.html` with `objective-agendas.js` from this directory embedded inline for Obsidian HTML Viewer compatibility. Its existing **Select agenda folder** imports the Markdown topics, roster and snapshot together. Refresh that folder after objective changes; browser data is a snapshot, not a live server connection. Missing snapshots clear previously imported objectives; malformed snapshots stop import and preserve the previous agenda. Matching is exact after whitespace and case normalization, never fuzzy. New employee associations create a person agenda even before a matching Markdown file exists.

Meeting checkmarks and notes stay browser-local and are separate per person and stable objective ID. They do not update Objective Manager status. The objective source link opens Obsidian. No absolute filesystem paths, external server, repository, or development dependencies are required to view the synchronized runtime.

## Adding a team member

No code change is needed. On an objective choose **People → Add a person**, enter the staff member’s exact display name, press **Add**, then **Save People**. Saving makes the name available in the other objective pickers and the People view. Enable **Show on agendas** and refresh Agenda Center’s Agenda Items folder to create that person’s objective agenda automatically. For regular Markdown agenda topics, also add the exact name to `_roster.json` and create the matching `<Name>.md` in Agenda Items.

The People view starts collapsed, with a count beside each name. Click the name to expand or collapse its objectives. Expanded groups remain open across refreshes and tab switches in that dashboard session.
