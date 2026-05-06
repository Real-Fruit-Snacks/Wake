# Changelog

All notable changes to Wake are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [0.7.2] - 2026-05-06

### Fixed
- **Project dropdown chevron crowded the visible text** in the new-task modal and the detail pane's project / recurrence selects. The previous chevron was rendered with two CSS `linear-gradient` filled triangles whose geometry produced two adjacent dark blocks at the top of the chevron area instead of a clean V — which read as "the project name got chopped off." The chevron is now drawn from an inline SVG, with more right-padding so the option text always has clear space before the icon. `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` are also set explicitly so genuinely long names get a proper ellipsis instead of arbitrary truncation.

## [0.7.1] - 2026-05-06

### Fixed
- **Migration corruption from 2-cycle data**: a hand-edited data file with mutually-pointing parents (A→B, B→A) could leave a task as its own parent after the v0.7.0 flattening pass. A second pass now strips self-parents.
- **Whitespace-only search matched everything**: typing three spaces in the toolbar search would return every task containing three consecutive spaces (so most of them). The search query is now trimmed before matching and highlighting.
- **Misleading drop notice + bloated undo stack**: dropping a task onto its own current effective parent (a no-op) showed "Cannot nest: this task already has subtasks" and pushed a useless undo entry. The same pattern existed for `Tab` indent and the `x` detach button. Drop / indent / detach now silently no-op when nothing changes, and only push undo entries on success.
- **Subtasks of a recurring parent were left attached to the completed instance**: the next occurrence had no subtasks, and the old subtasks rendered indented under the (logbook) parent in container views. Subtasks now re-arm with the next occurrence: they re-parent to the new instance and any completion is reset.

### Added
- **`[[` autocomplete in the subtask add input**: matches the title, description, and linked-notes inputs that already had it.
- **Project chip on cross-project subtasks**: when a subtask's project differs from its visible parent, the project chip is shown even in project-grouped views, so the mismatch is visible.

### Changed
- **`?` help modal won't stack**: pressing `?` while the help is already open is a no-op instead of opening a second modal underneath.
- **Bulk bar border cleanup**: removed the duplicate 1px line between the bulk action bar and the status bar.

## [0.7.0] - 2026-05-06

### Added
- **Subtasks**. Tasks can have nested subtasks one level deep. Add them from the detail pane (`+ Add subtask` input) or the row right-click menu. Parent rows show a `done/total` progress chip; subtasks render indented under their parent in views where both are visible. Use `Tab` to indent the cursor task as a subtask of the row above, `Shift+Tab` to promote it back to a root task.
- **Drag and drop**. Drag a task row onto another row to make it a subtask of the target. Drag a task onto a sidebar project (or Inbox) to reassign it. Visual hint highlights the drop target.
- **Bulk action bar**. When two or more rows are selected, a toolbar appears above the status bar with `Toggle complete`, priority pills, due-date shortcuts (`Today` / `Tomorrow` / `Clear`), `Move to...` menu, and `Delete`. Replaces having to right-click for every batch operation.
- **Keyboard cheatsheet**. Press `?` while a Wake panel is focused to open a multi-column overlay listing every shortcut, grouped by category. Press `?` or `Escape` again to dismiss.
- **Wider search scope**. The toolbar search now matches task descriptions, tags, linked-note names, and project names — not just the title — and matches are highlighted inline in the row.

### Changed
- The detail pane's right-click action `Add subtask...` opens the parent's detail pane and focuses the new-subtask input instead of opening a separate prompt.

### Notes
- 1-level depth is enforced. Dragging a task that already has subtasks onto another row is refused (you'd otherwise create grand-children); the offending row gets a notice instead. Existing data with deeper nesting is flattened on load.
- Deleting a task with subtasks orphans the children (they become root tasks) rather than cascade-deleting them.

## [0.6.5] - 2026-05-05

### Added
- `[[` triggers a note autocomplete popup in the new-task input, the inline edit (`e`), the title input, and the description textarea. Type `[[`, start typing the note name, pick from the dropdown — Wake inserts the name and auto-closes the brackets.
- The "Linked notes" chip input in the detail pane now shows the same note suggestions as you type. Pick one and it's added as a chip immediately.

### Fixed
- Typing in the toolbar search no longer drops after the first letter. The toolbar gets fully rebuilt on every keystroke; focus is now captured and restored across the re-render.
- The Project dropdown in the new-task modal no longer clips the text. Adjusted the chevron padding and centered it vertically.

## [0.6.4] - 2026-05-05

### Added
- Project picker dropdown in the new-task modal. Defaults to the active view's project (or Inbox), but you can change it inline before creating the task. Replaces the previous static "Will be added to: ..." subtitle.

## [0.6.3] - 2026-05-01

### Fixed
- Single click on the detail pane's Close (or any action button) now works after editing the title or description. Previously a click was eaten because the textarea's blur-triggered re-render destroyed the click target before the click event could fire — fixed by deferring the field's save to the next tick.

## [0.6.2] - 2026-05-01

### Changed
- Completion date is now editable. When a task is completed, the detail pane shows a *Completed on* date input — backdate it if you finished work earlier than you marked it done. The read-only `Completed` line in the metadata strip is gone (the editable field replaces it).

## [0.6.1] - 2026-05-01

### Changed
- Completed tasks now stay visible inside their project and Inbox views (they were previously only visible in the Logbook). Project / Inbox views always show completed work; time-based smart lists (`Today`, `This Week`, `Overdue`, `No Date`) and `All Active` still respect the *Show completed* setting.
- Completed tasks now sink to the bottom of every group, sorted by completion date (newest first). Active work stays visually prominent regardless of how the view is grouped or sorted.

### Fixed
- Releases now ship a `wake-<version>.zip` install bundle alongside the individual files. Extract directly into `<vault>/.obsidian/plugins/`.

## [0.6.0] - 2026-04-30

### Added
- Right-click context menus on task rows, sidebar projects, and group headers.
- Project reordering (`Move up` / `Move down`) and color picker via right-click.
- Task duplication (right-click a row → `Duplicate`).
- Bulk operations through right-click when multiple rows are selected.
- Per-view smart defaults: `Today` flat-lists, `This Week` and `Overdue` group by due date, `Logbook` groups by completion date.
- Per-view group/sort overrides — toolbar dropdowns now save per-view, with `Reset to default` available.
- Display density setting (`Comfortable` / `Compact`).
- Date format setting (`Short` / `Long` / `ISO` / `Relative`).
- New-task default setting (`Current view's project` / `Inbox always`).
- Sidebar toggles for tag section and archived projects.
- Settings tab redesigned with `General`, `Sidebar`, `Defaults`, `Data`, `About` sections.
- `Export to JSON` and `Reset all data` (with type-to-confirm modal).
- Live settings: changes propagate to open Wake views without re-opening.

### Changed
- Settings now layered: per-view override > smart default > user global.
- `Group:` and `Sort:` toolbar pills are now functional dropdown menus.

## [0.5.0] - 2026-04-30

### Added
- Projects: create, rename, archive, delete, color, reorder.
- Sidebar with smart lists, projects (Inbox + user-created), and tags.
- Logbook view: completed tasks preserved forever, grouped by completion date.
- Inline detail pane: click any row to expand a full edit form.
- `description` field on every task (multi-line notes).
- New-project and rename-project modals with color swatch picker.
- Tag chip input and link chip input in the detail pane.

### Changed
- "Project = first tag" hack removed. Tasks now have an explicit `project` field (a project ID or `null` for Inbox).
- Migration: existing tasks with string `project` values silently reset to `null`.

## [0.4.0] - 2026-04-30

### Added
- No-emoji metadata syntax: `due:DATE`, `start:DATE`, `every:VALUE`, `done:DATE`, `!1`–`!4` for priority.
- Live preview in Quick Add modal, syntax cheat strip, primary/secondary action buttons.

### Changed
- Plugin id and name finalized as `wake`.
- Author set to Real-Fruit-Snacks.
- All emoji removed from UI, parser, and CSS (CSS-drawn checkmark, no `✓` glyph).

## [0.3.0] - 2026-04-30

### Changed
- Self-contained data: tasks now live in plugin storage (`data.json`), not vault markdown.
- `TodoIndex` (vault scanner) replaced with `TodoStore` (plugin-owned).
- Source column → Reference column (clickable `[[Note]]` links).
- Settings simplified: dropped `inboxFile`, `dailyNoteFolder`, `ignoreFolders`.

## [0.2.0] - 2026-04-30

### Added
- Saved views (Today, Overdue, This Week, No Date, Completed).
- Recurring tasks (`every day`, `every week`, `every monday`, `every N days`).
- Keyboard reorder within file (`Shift+J` / `Shift+K`).
- Logbook view (initial form).

## [0.1.0] - 2026-04-30

Initial release. Power-user dense view with multi-select, inline edit, command palette, peek panel, undo, toasts, sidebar groups by project. Tasks parsed from vault markdown via Tasks-plugin emoji format.
