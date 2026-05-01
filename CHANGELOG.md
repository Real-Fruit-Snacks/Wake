# Changelog

All notable changes to Wake are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

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
