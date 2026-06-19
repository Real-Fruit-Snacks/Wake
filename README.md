<div align="center">

  # Wake

  **A keyboard-first task manager for Obsidian.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-cba6f7.svg)](https://opensource.org/licenses/MIT)
  [![Version](https://img.shields.io/badge/version-0.8.0-89b4fa)](https://github.com/Real-Fruit-Snacks/Wake/releases)
  
  [Documentation](https://Real-Fruit-Snacks.github.io/Wake) • [Report Issue](https://github.com/Real-Fruit-Snacks/Wake/issues) • [Request Feature](https://github.com/Real-Fruit-Snacks/Wake/issues)

</div>

---

## Overview

Wake is a keyboard-first task manager for Obsidian that maintains a self-contained task database. Tasks live inside the plugin and reference vault notes via `[[Note]]` links. Your vault stays clean, your tasks stay searchable, and your history stays forever. 

*To wake is to surface from sleep with intent — pulled out of background noise into focus. Felt fitting for a tool whose entire job is to surface what matters today and let everything else fade.*

### Key Features

- **Self-contained Storage:** Tasks are stored in `data.json` — Wake does not scan, parse, or modify your markdown notes.
- **Keyboard-first Navigation:** Every action has a keyboard binding. Quick-add (`Ctrl+Shift+T`) parses metadata as you type.
- **Smart Lists:** Six automatic lists in the sidebar (Active, Today, Overdue, This Week, No Date, Logbook) group and sort automatically.
- **Recurrence DSL:** Advanced recurrence engine parsing syntax like `every:day`, `every:week`, `every:monday`.
- **Zero External Dependencies:** Built purely on TypeScript and the Obsidian Plugin API.

---

## Getting Started

### Installation

**Manual install:**

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest [release](https://github.com/Real-Fruit-Snacks/Wake/releases).
2. Create `<your-vault>/.obsidian/plugins/wake/`.
3. Drop the three files into that folder.
4. Navigate to **Settings -> Community plugins** and enable **Wake**.
5. Click the check-circle ribbon icon, or run **Open Wake panel** from the command palette.

**Via BRAT:**

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add this repository's URL.

---

## Usage

### Quickstart

To add your first task, use the quick-add syntax anywhere in Obsidian:

```bash
# Press Ctrl+Shift+T to open quick-add
"Buy groceries due:tomorrow #errands [[Shopping list]] !2"
```

*This parses Title, due date, tag, linked note, and priority in one fluid line.*

Use `Ctrl+K` to open the command palette for every other action, and standard `j` / `k` keys to navigate the task list.

*For extensive usage examples, payload configuration, and API details, please refer to the [Documentation](https://Real-Fruit-Snacks.github.io/Wake).*

---

## Architecture

A high-level overview of the plugin's structure:

```text
wake/
├── main.js          # Plugin entry — ribbon, commands, view, hotkeys
├── manifest.json    # Obsidian plugin manifest
├── styles.css       # Catppuccin-aware theming, compact + cozy density
└── data.json        # (Created in vault) — Tasks, projects, settings, logbook
```

All state lives in `<vault>/.obsidian/plugins/wake/data.json` — a single JSON document with `todos[]`, `projects[]`, settings, and per-view overrides. This architecture ensures Wake never touches your markdown.

---

## Contributing

Contributions from the community are highly encouraged. Whether it's adding new features, improving the parser, or fixing bugs, your help is appreciated.

Please refer to the `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` files for full guidelines on how to submit pull requests and report issues.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

## Contact

Real-Fruit-Snacks - [https://github.com/Real-Fruit-Snacks](https://github.com/Real-Fruit-Snacks)

Project Link: [https://github.com/Real-Fruit-Snacks/Wake](https://github.com/Real-Fruit-Snacks/Wake)
