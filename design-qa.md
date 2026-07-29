# Design QA — Dashboard Card Overflow

## Current QA target: Recent update auto height

- Source visual truth:
  - `docs/testing/visual/reference-recent-update-overflow.jpg` (1016 × 1280)
- Implementation screenshot:
  - `docs/testing/visual/implementation-recent-update-overflow-fixed.jpg` (1198 × 711)
- Focused side-by-side comparison:
  - `docs/testing/visual/comparison-recent-update-overflow.jpg` (1800 × 400)
- Environment: Obsidian 1.12.7 desktop, FJG Vault, light theme, live task data.
- Viewport: 1198 × 711 captured application pixels.
- State: Tasks tab, Delegated view, unfiltered list, with `Immediate CalWORKs
  Termination of Work Study student` immediately above the next task card.
- Density normalization: the source and implementation task-card regions were
  cropped and each resized to 900 × 400 with contain scaling before the focused
  comparison. Browser and application chrome were excluded from the focused
  judgment.

## Current required surfaces

- Recent Updates title row.
- Update date and actor.
- Full update text.
- Bottom boundary and padding of the update button.
- Separation between the current task and the following task card.
- Existing task title, status, Related files, and actions.

## Current comparison history

### Pass 1

- Finding (P1): Obsidian's theme constrained the Recent Updates button to a
  fixed control height. Only the task-title row occupied the button background;
  the date, actor, and update text spilled below the task card and underneath
  the following task.
- Fix: added a dashboard-scoped update-button reset with `height: auto`,
  `min-height: 0`, `max-height: none`, normal whitespace wrapping, and visible
  overflow. The update title row now top-aligns and may wrap safely.

### Final comparison

- Full-view evidence: the corrected unfiltered Delegated list shows the entire
  update panel inside the Immediate CalWORKs task card and a clean gap before
  `Onboarding and Initial Meetings — CalWORKs`.
- Focused evidence: the side-by-side comparison shows the source spill on the
  left and the corrected title, date, actor, and full update line contained on
  the right.
- Typography: existing family, weights, sizes, and hierarchy are preserved;
  update text is no longer cropped or visually detached.
- Spacing and layout: the update button now owns its natural content height and
  retains internal padding and card-to-card separation.
- Colors and tokens: existing dashboard surface, teal update title, muted
  metadata, and borders are unchanged.
- Image and icon quality: the existing Obsidian `list-checks` icon remains
  sharp and unchanged; no raster or replacement asset was introduced.
- Copy and content: the complete task title, `Jul 28, 2026 · Franklin`, and
  `Status changed from do-first to delegate.` are visible.
- No P0, P1, or P2 findings remain.

## Prior QA target: Long task titles

- Source references:
  - `docs/testing/visual/reference-long-title-furniture.jpg` (919 × 315)
  - `docs/testing/visual/reference-long-title-a2mend.jpg` (930 × 590)
- Implementation captures:
  - `docs/testing/visual/implementation-long-title-furniture.jpg` (1198 × 711)
  - `docs/testing/visual/implementation-long-title-a2mend.jpg` (1198 × 711)
- Focused side-by-side comparison:
  - `docs/testing/visual/comparison-long-title-furniture.jpg`
- Environment: Obsidian 1.12.7 desktop, FJG Vault, light theme, live task data.
- State: Tasks tab, Do First view, task title search applied.

## Required surfaces

- Multiline title callout.
- Status badge and project metadata.
- Status selector, Update, and Archive controls.
- Related files actions.
- Recent updates header and empty state.

## Iteration history

### Pass 1

- Finding (P1): Obsidian's default button height constrained the multiline
  title control, allowing a third line to escape the purple callout and overlap
  the task metadata.
- Change: added a dashboard-scoped title-button reset, reduced the title to
  `0.92rem` with `1.18` line height, and top-aligned the task header controls.

### Pass 2

- Finding (P1): the more specific theme height still overrode the initial
  reset.
- Change: explicitly set the title control to `height: auto`,
  `min-height: 0`, and `max-height: none`.

### Final comparison

- The complete furniture title stays inside the callout.
- The A2MEND title stays inside the callout.
- Status and project metadata remain below the title with a visible gap.
- Header controls align to the title's top edge.
- Related files and Recent updates remain aligned and unclipped.
- No P0, P1, or P2 visual issues remain.

## Final result

final result: passed
