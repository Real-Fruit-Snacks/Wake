# Wake

A keyboard-first task manager for [Obsidian](https://obsidian.md). Tasks live inside the plugin and reference vault notes via `[[Note]]` — your vault stays clean, your tasks stay searchable, your history stays forever.

> **Note:** Wake stores all tasks in its own `data.json`. It does not scan, parse, or modify your markdown notes. If you want tasks embedded in markdown, you want a different plugin — Wake is the opposite philosophy.

---

## Features

- **Self-contained tasks.** Stored in the plugin's `data.json`. No vault clutter, no markdown parsing.
- **Projects** with colors, archive, and reordering. Tasks can be assigned to one project (or none — that's the Inbox).
- **Smart Lists** in the sidebar: `All Active`, `Today`, `Overdue`, `This Week`, `No Date`, `Logbook`.
- **Logbook** preserves every completed task forever, grouped by completion date.
- **Detail pane** — click any task to expand a full edit form inline (title, description, priority, due, start, recurrence, project, tags, links).
- **Tags** — `#tag` for cross-cutting categorization. Sidebar lists every tag in use.
- **Linked notes** — embed `[[Note]]` references in any task; click to open the note.
- **Recurring tasks** — `every:day`, `every:week`, `every:monday`, `every:3-days`, etc. Completion creates the next instance and archives the current one.
- **Per-view smart defaults** — `Today` auto-flat-lists, `This Week` groups by date, `Logbook` groups by completion date. Override per view; reset anytime.
- **Right-click context menus** on rows, projects, and group headers.
- **Command palette** (`Ctrl+K` / `Cmd+K`) for every action.
- **Quick add** (`Ctrl+Shift+T` / `Cmd+Shift+T`) with live preview as you type.
- **Multi-select** with `Shift+click` (range) and `Ctrl+click` (toggle).
- **Compact density** mode for power users.
- **Export to JSON** and **Reset all data** with type-to-confirm.
- **No emojis** anywhere — clean typography throughout.

---

## Installation

### Manual install

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest [release](../../releases).
2. Create a folder `<your-vault>/.obsidian/plugins/wake/`.
3. Drop the three files into that folder.
4. In Obsidian, go to **Settings → Community plugins** and enable **Wake**.
5. Click the check-circle ribbon icon, or run **Open Wake panel** from the command palette.

### Via [BRAT](https://github.com/TfTHacker/obsidian42-brat) (beta plugin)

Install BRAT, then in BRAT settings add this repo's URL.

---

## Quick start

1. Open Wake (ribbon icon or `Open Wake panel` command).
2. Press `Ctrl+Shift+T` to add your first task.
3. Type something with metadata inline:

   ```
   Buy groceries due:tomorrow #errands [[Shopping list]] !2
   ```

4. The preview at the bottom of the modal shows how Wake parses it. Hit **Enter**.
5. Click the row to expand the detail pane. Edit anything; changes save on blur.
6. Right-click for quick actions like *Snooze → Tomorrow* or *Move to project*.

---

## Task syntax

Wake parses these tokens out of any task's text — in the quick-add box, the inline editor (`e`), or the detail pane title.

| Token | Example | Effect |
|---|---|---|
| `!1` `!2` `!3` `!4` | `Submit report !2` | Set priority (P1 = urgent, P4 = low) |
| `due:YYYY-MM-DD` | `due:2026-05-01` | Set due date |
| `today` / `tomorrow` | `Call dentist today` | Shorthand for due date |
| `start:YYYY-MM-DD` | `start:2026-04-28` | Set start (scheduled) date |
| `every:VALUE` | `every:week`, `every:monday`, `every:3-days` | Recurrence rule |
| `#tag` | `#errands` | Tag |
| `[[Note name]]` | `[[Shopping list]]` | Link to a vault note |

Recurrence values accepted: `day`, `week`, `month`, `year`, `monday`–`sunday`, `N-days`, `N-weeks`.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Move cursor down / up |
| `x` | Toggle complete on selection (or cursor) |
| `e` | Inline-edit task text |
| `Space` | Toggle detail pane |
| `Enter` | Open the linked note (if any) |
| `Shift+J` / `Shift+K` | Reorder cursor task within its project |
| `1` `2` `3` `4` | Set priority on selection |
| `z` | Undo last change |
| `Backspace` / `Delete` | Delete selection |
| `Esc` | Close detail pane, then clear selection |
| `Ctrl+A` | Select all visible tasks |
| `/` | Focus the search input |
| `Ctrl+K` | Open command palette |
| `Ctrl+Shift+T` | Quick add (works anywhere in Obsidian) |

> On macOS, `Ctrl` is `Cmd` and `Shift+J/K` is still `Shift+J/K`.

---

## Right-click menus

Right-click is wired up in three places:

- **Task rows** — toggle complete, edit, snooze, set priority/due/recurrence, move to project, duplicate, delete. Acts on the whole selection if the right-clicked task is part of it.
- **Sidebar projects** — rename, change color, move up/down, archive/unarchive, delete (orphans tasks to Inbox; never deletes the tasks).
- **Group headers** — collapse/expand this group, collapse/expand all groups.

---

## Settings

Open **Settings → Community Plugins → Wake** for:

**General**
- *Display density* — Comfortable / Compact
- *Date format* — Short / Long / ISO / Relative
- *New tasks default to* — Current view's project, or Inbox always

**Sidebar**
- Show tags section
- Show archived projects

**Defaults** *(fallback for views without smart defaults — `All Active`, `No Date`, `Inbox`, `Project`, `Tag`)*
- Default group by
- Default sort by
- Show completed by default
- Clear all per-view overrides

**Data**
- Stats summary (active / logbook / projects)
- **Export to JSON** — download a backup
- **Reset all data** — type-to-confirm modal

---

## How tasks are stored

Wake writes a single JSON blob to `<your-vault>/.obsidian/plugins/wake/data.json`. Schema (abridged):

```json
{
  "todos": [
    {
      "id": "wk-1",
      "text": "Replace kitchen faucet",
      "description": "...",
      "completed": false,
      "priority": 2,
      "due": "2026-05-02",
      "scheduled": null,
      "recurrence": null,
      "tags": ["plumbing"],
      "links": ["House Renovation"],
      "project": "pj-3",
      "createdAt": "2026-04-30T18:00:00.000Z",
      "completionDate": null,
      "order": 0
    }
  ],
  "projects": [
    { "id": "pj-1", "name": "House Renovation", "color": "#7c5cff", "archived": false, "order": 0, "createdAt": "..." }
  ],
  "lastId": 1,
  "lastProjectId": 1,
  "groupBy": "project",
  "sortBy": "priority",
  "showCompleted": false,
  "showArchivedProjects": false,
  "viewOverrides": {},
  "density": "comfortable",
  "dateFormat": "short",
  "newTaskDefault": "currentView",
  "showTagsInSidebar": true,
  "activeView": { "kind": "all" }
}
```

**Completed tasks are never auto-deleted.** They live in the Logbook view forever, grouped by completion date.

To move tasks between vaults, copy `data.json` from one vault's `wake` plugin folder to the other's. Or use **Settings → Wake → Data → Export to JSON**.

---

## Smart per-view defaults

| View | Default groupBy | Default sortBy | Why |
|---|---|---|---|
| Today | `none` | `priority` | Everything's already today; one flat list |
| This Week | `due` | `due` | Buckets under each upcoming day |
| Overdue | `due` | `due` | Bucketed by how-overdue |
| Logbook | `completion` | `completion` | History grouped by completion date |
| Others | *(global default)* | *(global default)* | User's preference applies |

Override any of these per view from the toolbar's `Group:` / `Sort:` dropdowns. Each menu shows a *Reset to default* entry once an override exists.

---

## Roadmap

Possible future work, roughly in priority order:

- Subtasks / checklists within a task
- Search expansion (description, tags, project names)
- Bulk action bar when multiple rows are selected
- Snooze and stats summaries
- Drag-and-drop between projects
- Calendar view (time-blocked, like Sunsama)
- Custom saved views

PRs welcome for any of these.

---

## License

[MIT](LICENSE)
