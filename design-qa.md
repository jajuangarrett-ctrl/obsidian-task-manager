# Design QA — Long Task Titles

## QA target

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

## Result

passed
