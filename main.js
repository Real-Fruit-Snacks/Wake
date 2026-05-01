'use strict';

const obsidian = require('obsidian');
const { Plugin, ItemView, Modal, Menu, PluginSettingTab, Setting, TFile, MarkdownView, Notice } = obsidian;

// ============================================================
// Constants & defaults
// ============================================================

const VIEW_TYPE_WAKE = 'wake-view';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = IS_MAC ? 'Cmd' : 'Ctrl';

const PROJECT_COLORS = [
  '#7c5cff', '#5b8def', '#4ec9b0', '#ffa53d',
  '#ff5e5e', '#b388ff', '#6dc8ff', '#88d066',
  '#f06292', '#a1887f',
];

const PROJECT_COLOR_LABELS = {
  '#7c5cff': 'Purple',
  '#5b8def': 'Blue',
  '#4ec9b0': 'Teal',
  '#ffa53d': 'Orange',
  '#ff5e5e': 'Red',
  '#b388ff': 'Violet',
  '#6dc8ff': 'Sky',
  '#88d066': 'Green',
  '#f06292': 'Pink',
  '#a1887f': 'Brown',
};

// Plugin's persistent data layout — written via Obsidian's saveData/loadData.
const DEFAULT_DATA = {
  // Global fallback group/sort — used by views that don't have a smart default.
  groupBy: 'project',
  sortBy: 'priority',
  showCompleted: false,
  showArchivedProjects: false,

  // Per-view override layer: { [viewKind]: { groupBy, sortBy } }
  viewOverrides: {},

  // Display preferences
  density: 'comfortable',     // 'comfortable' | 'compact'
  dateFormat: 'short',        // 'short' | 'iso' | 'long' | 'relative'
  newTaskDefault: 'currentView', // 'currentView' | 'inbox'
  showTagsInSidebar: true,

  // Data
  todos: [],
  projects: [],
  lastId: 0,
  lastProjectId: 0,
  activeView: { kind: 'all' },
};

const SMART_VIEWS = [
  { kind: 'all',      name: 'All Active' },
  { kind: 'today',    name: 'Today' },
  { kind: 'overdue',  name: 'Overdue' },
  { kind: 'thisWeek', name: 'This Week' },
  { kind: 'noDate',   name: 'No Date' },
  { kind: 'logbook',  name: 'Logbook' },
];

// Smart per-view defaults for grouping and sorting. Only specified for views where
// we have an opinion that overrides the user's global preference. Other views fall
// back to data.groupBy / data.sortBy.
const VIEW_DEFAULTS = {
  today:    { groupBy: 'none',       sortBy: 'priority' },
  thisWeek: { groupBy: 'due',        sortBy: 'due' },
  overdue:  { groupBy: 'due',        sortBy: 'due' },
  logbook:  { groupBy: 'completion', sortBy: 'completion' },
};

// Resolve effective group/sort for the active view.
// Priority: explicit override > smart default > user's global preference.
function resolveGrouping(view, data) {
  const key = view.kind;
  const override = (data.viewOverrides || {})[key] || {};
  const def = VIEW_DEFAULTS[key] || {};
  return {
    groupBy: override.groupBy ?? def.groupBy ?? data.groupBy,
    sortBy:  override.sortBy  ?? def.sortBy  ?? data.sortBy,
  };
}

// Returns true if the view's current group/sort comes purely from defaults
// (no explicit override). Used to label "Reset to default" availability.
function hasViewOverride(view, data, kind /* 'groupBy' | 'sortBy' */) {
  const override = (data.viewOverrides || {})[view.kind] || {};
  return override[kind] !== undefined;
}

// Markers usable inside the user's typed input (quick-add and inline edit).
const DUE_RE       = /\bdue:(\d{4}-\d{2}-\d{2})\b/;
const SCHEDULED_RE = /\bstart:(\d{4}-\d{2}-\d{2})\b/;
const DONE_RE      = /\bdone:(\d{4}-\d{2}-\d{2})\b/;
const RECUR_RE     = /\bevery:(\S+)/;
const PRIORITY_RE  = /(?:^|\s)!([1-4])(?=\s|$)/g;
const TAG_RE       = /#([\w\-/]+)/g;
const LINK_RE      = /\[\[([^\]]+)\]\]/g;

// ============================================================
// Date helpers
// ============================================================

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateLocal(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function today() { return fmtDate(new Date()); }
function isToday(date) { return date === today(); }
function isOverdue(date) { return date < today(); }

function nextWeekday(day) {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const target = days.indexOf(day);
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== target);
  return fmtDate(d);
}

function formatDue(date, format) {
  if (!date) return '';
  format = format || 'short';

  if (format === 'iso') return date;

  const d = parseDateLocal(date);
  const now = parseDateLocal(today());
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);

  if (format === 'long') {
    const yearOpt = d.getFullYear() === now.getFullYear() ? undefined : 'numeric';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: yearOpt });
  }

  if (format === 'relative') {
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 0 && days < 7) return `In ${days} day${days === 1 ? '' : 's'}`;
    if (days < 0 && days > -7) return `${-days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // 'short' (default): friendly today/tomorrow/Nd late, otherwise MM-DD.
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return `${-days}d late`;
  return date.slice(5);
}

function formatLogDate(date) {
  if (!date) return 'Unknown';
  if (isToday(date)) return 'Today';
  const d = parseDateLocal(date);
  const now = parseDateLocal(today());
  const days = Math.round((now.getTime() - d.getTime()) / 86400000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// ============================================================
// Recurrence — accepts values like "day", "week", "monday", "3-days"
// ============================================================

function nextRecurrenceDate(baseDate, recurrence) {
  const r = String(recurrence || '').toLowerCase().trim();
  const result = baseDate ? parseDateLocal(baseDate) : new Date();

  if (r === 'day' || r === 'daily')     { result.setDate(result.getDate() + 1); return fmtDate(result); }
  if (r === 'week' || r === 'weekly')   { result.setDate(result.getDate() + 7); return fmtDate(result); }
  if (r === 'month' || r === 'monthly') { result.setMonth(result.getMonth() + 1); return fmtDate(result); }
  if (r === 'year' || r === 'yearly')   { result.setFullYear(result.getFullYear() + 1); return fmtDate(result); }

  let m = r.match(/^(\d+)-?days?$/);
  if (m) { result.setDate(result.getDate() + parseInt(m[1], 10)); return fmtDate(result); }

  m = r.match(/^(\d+)-?weeks?$/);
  if (m) { result.setDate(result.getDate() + parseInt(m[1], 10) * 7); return fmtDate(result); }

  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  m = r.match(/^(sun|mon|tue|wed|thu|fri|sat)/);
  if (m) {
    const target = days.indexOf(m[1]);
    do { result.setDate(result.getDate() + 1); } while (result.getDay() !== target);
    return fmtDate(result);
  }

  return null;
}

// ============================================================
// Text parsing — extracts metadata from user input
// ============================================================

function expandDateShortcuts(input) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return input
    .replace(/\b(?:due:)?today\b/i, `due:${today()}`)
    .replace(/\b(?:due:)?tomorrow\b/i, `due:${fmtDate(tomorrow)}`);
}

function parseTodoText(input) {
  let text = expandDateShortcuts(input);

  let priority;
  PRIORITY_RE.lastIndex = 0;
  const priMatch = PRIORITY_RE.exec(text);
  if (priMatch) priority = parseInt(priMatch[1], 10);
  text = text.replace(PRIORITY_RE, ' ');

  const due = DUE_RE.exec(text)?.[1];
  text = text.replace(DUE_RE, '');

  const scheduled = SCHEDULED_RE.exec(text)?.[1];
  text = text.replace(SCHEDULED_RE, '');

  const recurrence = RECUR_RE.exec(text)?.[1]?.trim();
  text = text.replace(RECUR_RE, '');

  const tags = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) tags.push(m[1]);
  text = text.replace(TAG_RE, '');

  const links = [];
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) links.push(m[1].trim());
  text = text.replace(LINK_RE, '');

  text = text.replace(/\s+/g, ' ').trim();

  return { text, priority, due, scheduled, recurrence, tags, links };
}

function buildEditableText(t) {
  const parts = [t.text];
  if (t.priority) parts.push(`!${t.priority}`);
  if (t.due) parts.push(`due:${t.due}`);
  if (t.scheduled) parts.push(`start:${t.scheduled}`);
  if (t.recurrence) parts.push(`every:${t.recurrence}`);
  for (const tag of t.tags || []) parts.push(`#${tag}`);
  for (const link of t.links || []) parts.push(`[[${link}]]`);
  return parts.filter(Boolean).join(' ');
}

// ============================================================
// WakeStore — owns the data, persisted via plugin.saveData
// ============================================================

class WakeStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.listeners = new Set();
  }

  get todos() { return this.plugin.data.todos; }
  set todos(v) { this.plugin.data.todos = v; }

  all() { return this.todos.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
  byId(id) { return this.todos.find(t => t.id === id); }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() { this.listeners.forEach(l => l()); }

  async commit() {
    this.notify();
    await this.plugin.save();
  }

  // ---- Tasks ----

  async add(rawInput, defaultProjectId = null) {
    const parsed = parseTodoText(rawInput);
    this.plugin.data.lastId += 1;
    const t = {
      id: `wk-${this.plugin.data.lastId}`,
      text: parsed.text,
      description: '',
      completed: false,
      priority: parsed.priority,
      due: parsed.due,
      scheduled: parsed.scheduled,
      recurrence: parsed.recurrence,
      tags: parsed.tags,
      links: parsed.links,
      project: defaultProjectId || null,
      createdAt: new Date().toISOString(),
      order: this.todos.length,
    };
    this.todos.push(t);
    await this.commit();
    return t;
  }

  async update(id, change) {
    const t = this.byId(id);
    if (!t) return;
    Object.assign(t, change);
    await this.commit();
  }

  async updateFromRawText(id, rawInput) {
    const t = this.byId(id);
    if (!t) return;
    const parsed = parseTodoText(rawInput);
    t.text = parsed.text;
    t.priority = parsed.priority;
    t.due = parsed.due;
    t.scheduled = parsed.scheduled;
    t.recurrence = parsed.recurrence;
    t.tags = parsed.tags;
    t.links = parsed.links;
    await this.commit();
  }

  async duplicate(id) {
    const orig = this.byId(id);
    if (!orig) return null;
    this.plugin.data.lastId += 1;
    const copy = {
      ...orig,
      id: `wk-${this.plugin.data.lastId}`,
      completed: false,
      completionDate: undefined,
      createdAt: new Date().toISOString(),
    };
    const idx = this.todos.findIndex(t => t.id === id);
    this.todos.splice(idx + 1, 0, copy);
    this.todos.forEach((t, i) => t.order = i);
    await this.commit();
    return copy;
  }

  async remove(id) {
    this.todos = this.todos.filter(t => t.id !== id);
    this.todos.forEach((t, i) => t.order = i);
    await this.commit();
  }

  async move(id, direction) {
    const sorted = this.all();
    const i = sorted.findIndex(t => t.id === id);
    if (i === -1) return false;
    const j = i + direction;
    if (j < 0 || j >= sorted.length) return false;
    [sorted[i].order, sorted[j].order] = [sorted[j].order, sorted[i].order];
    await this.commit();
    return true;
  }

  async toggleComplete(id) {
    const t = this.byId(id);
    if (!t) return { recurred: false };
    if (t.completed) {
      // Uncomplete: keep history-friendly — clear completion stamp but keep the task.
      t.completed = false;
      t.completionDate = undefined;
      await this.commit();
      return { recurred: false };
    }
    if (!t.recurrence) {
      t.completed = true;
      t.completionDate = today();
      await this.commit();
      return { recurred: false };
    }
    const nextDate = nextRecurrenceDate(t.due, t.recurrence);
    if (!nextDate) {
      t.completed = true;
      t.completionDate = today();
      await this.commit();
      return { recurred: false };
    }
    // Recurring task: mark this instance complete (preserved in logbook),
    // and create the next instance below it.
    t.completed = true;
    t.completionDate = today();
    this.plugin.data.lastId += 1;
    const next = {
      ...t,
      id: `wk-${this.plugin.data.lastId}`,
      completed: false,
      completionDate: undefined,
      due: nextDate,
      createdAt: new Date().toISOString(),
    };
    const idx = this.todos.findIndex(x => x.id === id);
    this.todos.splice(idx + 1, 0, next);
    this.todos.forEach((x, i) => x.order = i);
    await this.commit();
    return { recurred: true, nextDate };
  }

  async moveToProject(todoId, projectId) {
    await this.update(todoId, { project: projectId });
  }

  // ---- Projects ----

  allProjects() {
    return this.plugin.data.projects
      .filter(p => !p.archived)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  archivedProjects() {
    return this.plugin.data.projects
      .filter(p => p.archived)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  projectById(id) {
    return this.plugin.data.projects.find(p => p.id === id);
  }

  async createProject(name, color) {
    this.plugin.data.lastProjectId += 1;
    const usedColors = new Set(this.plugin.data.projects.map(p => p.color));
    const fallbackColor = PROJECT_COLORS.find(c => !usedColors.has(c)) || PROJECT_COLORS[this.plugin.data.lastProjectId % PROJECT_COLORS.length];
    const p = {
      id: `pj-${this.plugin.data.lastProjectId}`,
      name: name.trim() || 'Untitled project',
      color: color || fallbackColor,
      archived: false,
      order: this.plugin.data.projects.length,
      createdAt: new Date().toISOString(),
    };
    this.plugin.data.projects.push(p);
    await this.commit();
    return p;
  }

  async renameProject(id, newName) {
    const p = this.projectById(id);
    if (!p) return;
    p.name = newName.trim() || p.name;
    await this.commit();
  }

  async setProjectColor(id, color) {
    const p = this.projectById(id);
    if (!p) return;
    p.color = color;
    await this.commit();
  }

  async archiveProject(id) {
    const p = this.projectById(id);
    if (!p) return;
    p.archived = true;
    await this.commit();
  }

  async unarchiveProject(id) {
    const p = this.projectById(id);
    if (!p) return;
    p.archived = false;
    await this.commit();
  }

  async moveProject(id, direction) {
    const all = this.allProjects();
    const i = all.findIndex(p => p.id === id);
    if (i === -1) return false;
    const j = i + direction;
    if (j < 0 || j >= all.length) return false;
    [all[i].order, all[j].order] = [all[j].order, all[i].order];
    await this.commit();
    return true;
  }

  async deleteProject(id) {
    // Destructive: removes the project. Tasks lose their project assignment but ARE preserved.
    this.plugin.data.projects = this.plugin.data.projects.filter(p => p.id !== id);
    for (const t of this.todos) if (t.project === id) t.project = null;
    await this.commit();
  }

  // ---- Tags (derived) ----

  allTags() {
    const set = new Set();
    for (const t of this.todos) {
      if (!t.completed) for (const tag of t.tags || []) set.add(tag);
    }
    return [...set].sort();
  }
}

// ============================================================
// View: filter + group
// ============================================================

function applyView(todos, view, search, showCompleted) {
  let result = todos.slice();

  const isLogbook = view.kind === 'logbook';
  if (isLogbook) {
    result = result.filter(t => t.completed);
  } else if (!showCompleted) {
    result = result.filter(t => !t.completed);
  }

  if (view.kind === 'today')    result = result.filter(t => t.due === today());
  if (view.kind === 'overdue')  result = result.filter(t => t.due && t.due < today() && !t.completed);
  if (view.kind === 'thisWeek') {
    const end = new Date(); end.setDate(end.getDate() + 7);
    const endStr = fmtDate(end);
    result = result.filter(t => t.due && t.due >= today() && t.due <= endStr);
  }
  if (view.kind === 'noDate')   result = result.filter(t => !t.due);
  if (view.kind === 'inbox')    result = result.filter(t => !t.project);
  if (view.kind === 'project')  result = result.filter(t => t.project === view.ref);
  if (view.kind === 'tag')      result = result.filter(t => (t.tags || []).includes(view.ref));

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(t => (t.text || '').toLowerCase().includes(q));
  }
  return result;
}

function viewLabel(view, store) {
  if (view.kind === 'project') {
    const p = store.projectById(view.ref);
    return p ? p.name : 'Unknown project';
  }
  if (view.kind === 'tag') return '#' + view.ref;
  if (view.kind === 'inbox') return 'Inbox';
  const sm = SMART_VIEWS.find(v => v.kind === view.kind);
  return sm ? sm.name : 'All Active';
}

// effectiveGroupBy was replaced by resolveGrouping (see top of file).

// ============================================================
// Render
// ============================================================

const PRIORITY_LABELS = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function groupTodos(todos, by, store) {
  const groups = new Map();
  for (const t of todos) {
    let key;
    if (by === 'project') {
      const p = t.project ? store.projectById(t.project) : null;
      key = p ? p.name : 'Inbox';
    } else if (by === 'priority') {
      key = t.priority ? `P${t.priority}` : 'No priority';
    } else if (by === 'due') {
      key = t.due ?? 'No date';
    } else if (by === 'tag') {
      key = (t.tags && t.tags[0]) ?? 'No tag';
    } else if (by === 'completion') {
      key = formatLogDate(t.completionDate);
    } else {
      key = 'All tasks';
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return groups;
}

function sortInGroups(groups, sortBy, by) {
  for (const todos of groups.values()) {
    todos.sort((a, b) => {
      if (by === 'completion') {
        return (b.completionDate ?? '').localeCompare(a.completionDate ?? '');
      }
      if (sortBy === 'priority') return (a.priority ?? 99) - (b.priority ?? 99);
      if (sortBy === 'due')      return (a.due ?? 'zzzz').localeCompare(b.due ?? 'zzzz');
      if (sortBy === 'manual')   return (a.order ?? 0) - (b.order ?? 0);
      if (sortBy === 'created')  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      return 0;
    });
  }
}

function renderToolbar(toolbar, state, store, h) {
  toolbar.empty();

  const newBtn = toolbar.createSpan({ cls: 'wk-pill wk-pill-new', text: '+ New task' });
  newBtn.addEventListener('click', () => h.onNewTask());

  toolbar.createDiv('wk-spacer');

  const { groupBy, sortBy } = resolveGrouping(state.activeView, state);
  const groupBtn = toolbar.createSpan({ cls: 'wk-pill wk-pill-menu', text: `Group: ${capitalize(groupBy)}` });
  groupBtn.addEventListener('click', e => h.onOpenGroupMenu(e));

  const sortBtn = toolbar.createSpan({ cls: 'wk-pill wk-pill-menu', text: `Sort: ${capitalize(sortBy)}` });
  sortBtn.addEventListener('click', e => h.onOpenSortMenu(e));

  const search = toolbar.createEl('input', { cls: 'wk-search', type: 'text' });
  search.placeholder = 'Search tasks...  /';
  search.value = state.search;
  search.addEventListener('input', () => h.onSearch(search.value));
}

function renderSidebar(sidebar, state, store, h) {
  sidebar.empty();

  // Smart Lists
  const smartHead = sidebar.createDiv('wk-side-section');
  smartHead.createSpan({ cls: 'wk-side-section-title', text: 'Smart Lists' });
  for (const sv of SMART_VIEWS) {
    const item = sidebar.createDiv('wk-side-item');
    if (state.activeView.kind === sv.kind) item.addClass('wk-side-item-active');
    item.createSpan({ cls: 'wk-side-name', text: sv.name });
    const count = countForSmart(sv.kind, store.todos);
    if (count > 0) item.createSpan({ cls: 'wk-side-count', text: String(count) });
    item.addEventListener('click', () => h.onSelectView({ kind: sv.kind }));
  }

  // Projects
  const projHead = sidebar.createDiv('wk-side-section');
  projHead.createSpan({ cls: 'wk-side-section-title', text: 'Projects' });
  const addBtn = projHead.createSpan({ cls: 'wk-side-add', text: '+' });
  addBtn.setAttribute('title', 'New project');
  addBtn.addEventListener('click', e => { e.stopPropagation(); h.onNewProject(); });

  // Inbox (no project)
  const inboxItem = sidebar.createDiv('wk-side-item');
  if (state.activeView.kind === 'inbox') inboxItem.addClass('wk-side-item-active');
  inboxItem.createSpan({ cls: 'wk-side-dot', attr: { style: 'background: var(--wk-text-dim)' } });
  inboxItem.createSpan({ cls: 'wk-side-name', text: 'Inbox' });
  const inboxCount = store.todos.filter(t => !t.completed && !t.project).length;
  if (inboxCount > 0) inboxItem.createSpan({ cls: 'wk-side-count', text: String(inboxCount) });
  inboxItem.addEventListener('click', () => h.onSelectView({ kind: 'inbox' }));

  for (const p of store.allProjects()) {
    const item = sidebar.createDiv('wk-side-item');
    if (state.activeView.kind === 'project' && state.activeView.ref === p.id) item.addClass('wk-side-item-active');
    item.createSpan({ cls: 'wk-side-dot', attr: { style: `background: ${p.color}` } });
    item.createSpan({ cls: 'wk-side-name', text: p.name });
    const count = store.todos.filter(t => !t.completed && t.project === p.id).length;
    if (count > 0) item.createSpan({ cls: 'wk-side-count', text: String(count) });
    item.addEventListener('click', () => h.onSelectView({ kind: 'project', ref: p.id }));
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      h.onContextProject(e, p.id);
    });
  }

  if (state.showArchivedProjects) {
    const arch = store.archivedProjects();
    if (arch.length > 0) {
      sidebar.createDiv({ cls: 'wk-side-subhead', text: 'Archived' });
      for (const p of arch) {
        const item = sidebar.createDiv('wk-side-item wk-side-item-archived');
        if (state.activeView.kind === 'project' && state.activeView.ref === p.id) item.addClass('wk-side-item-active');
        item.createSpan({ cls: 'wk-side-dot', attr: { style: `background: ${p.color}` } });
        item.createSpan({ cls: 'wk-side-name', text: p.name });
        item.addEventListener('click', () => h.onSelectView({ kind: 'project', ref: p.id }));
        item.addEventListener('contextmenu', e => {
          e.preventDefault();
          e.stopPropagation();
          h.onContextProject(e, p.id);
        });
      }
    }
  }

  // Tags
  const tags = state.showTagsInSidebar !== false ? store.allTags() : [];
  if (tags.length > 0) {
    sidebar.createDiv('wk-side-section').createSpan({ cls: 'wk-side-section-title', text: 'Tags' });
    for (const tag of tags) {
      const item = sidebar.createDiv('wk-side-item');
      if (state.activeView.kind === 'tag' && state.activeView.ref === tag) item.addClass('wk-side-item-active');
      item.createSpan({ cls: 'wk-side-tag', text: '#' + tag });
      const count = store.todos.filter(t => !t.completed && (t.tags || []).includes(tag)).length;
      if (count > 0) item.createSpan({ cls: 'wk-side-count', text: String(count) });
      item.addEventListener('click', () => h.onSelectView({ kind: 'tag', ref: tag }));
    }
  }
}

function countForSmart(kind, todos) {
  if (kind === 'logbook') return todos.filter(t => t.completed).length;
  const active = todos.filter(t => !t.completed);
  if (kind === 'all') return active.length;
  if (kind === 'today') return active.filter(t => t.due === today()).length;
  if (kind === 'overdue') return active.filter(t => t.due && t.due < today()).length;
  if (kind === 'thisWeek') {
    const end = new Date(); end.setDate(end.getDate() + 7);
    const endStr = fmtDate(end);
    return active.filter(t => t.due && t.due >= today() && t.due <= endStr).length;
  }
  if (kind === 'noDate') return active.filter(t => !t.due).length;
  return 0;
}

function renderRow(body, t, state, store, h) {
  const row = body.createDiv('wk-row');
  row.dataset.todoId = t.id;
  if (state.selected.has(t.id)) row.addClass('wk-selected');
  if (state.cursor === t.id) row.addClass('wk-cursor');
  if (t.completed) row.addClass('wk-done');

  const check = row.createDiv('wk-check');
  if (t.completed) check.addClass('wk-check-done');
  check.addEventListener('click', e => { e.stopPropagation(); h.onToggle(t.id); });

  const pri = row.createSpan({ cls: 'wk-cell-pri' });
  if (t.priority) {
    pri.addClass(`wk-pri-${t.priority}`);
    pri.setText(PRIORITY_LABELS[t.priority]);
  } else {
    pri.setText('-');
  }

  row.createSpan({ cls: 'wk-cell-text', text: t.text });

  const meta = row.createSpan('wk-row-meta');
  const { groupBy } = resolveGrouping(state.activeView, state);
  if (t.project && groupBy !== 'project') {
    const p = store.projectById(t.project);
    if (p) {
      const chip = meta.createSpan('wk-proj-chip');
      chip.createSpan({ cls: 'wk-side-dot', attr: { style: `background: ${p.color}` } });
      chip.createSpan({ cls: 'wk-proj-name', text: p.name });
    }
  }
  if (t.tags && t.tags.length > 0 && groupBy !== 'tag') {
    meta.createSpan({ cls: 'wk-tag', text: t.tags[0] });
  }

  const due = row.createSpan({ cls: 'wk-due' });
  if (t.due) {
    due.setText(formatDue(t.due, state.dateFormat));
    if (isToday(t.due)) due.addClass('wk-due-today');
    else if (isOverdue(t.due) && !t.completed) due.addClass('wk-due-overdue');
  } else if (t.completed && t.completionDate) {
    due.setText(t.completionDate.slice(5));
    due.addClass('wk-due-done');
  } else {
    due.setText('-');
  }
  if (t.recurrence) {
    const rec = row.createSpan({ cls: 'wk-rec', text: 'rep' });
    rec.setAttribute('title', `Recurs every ${t.recurrence}`);
  } else {
    row.createSpan();
  }

  const refCell = row.createSpan('wk-ref');
  if (t.links && t.links.length > 0) {
    refCell.addClass('wk-ref-link');
    refCell.setText(t.links.length > 1 ? `[[${t.links[0]}]] +${t.links.length - 1}` : `[[${t.links[0]}]]`);
    refCell.addEventListener('click', e => { e.stopPropagation(); h.onOpenRef(t.id); });
  } else {
    refCell.setText('-');
  }

  row.addEventListener('click', e => {
    if (e.target.closest('.wk-check') || e.target.closest('.wk-ref-link')) return;
    h.onClickRow(t.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
  });
  row.addEventListener('dblclick', e => {
    if (e.target.closest('.wk-check')) return;
    h.onDoubleClick(t.id);
  });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    h.onContextRow(e, t.id);
  });
}

function renderDetail(body, t, state, store, h) {
  const detail = body.createDiv('wk-detail');

  // Helper: stop keyboard events from leaking into the panel-level shortcuts.
  const stop = e => e.stopPropagation();

  // ---- Title ----
  const titleSection = detail.createDiv('wk-detail-section');
  titleSection.createDiv({ cls: 'wk-detail-label', text: 'Title' });
  const titleInput = titleSection.createEl('input', { cls: 'wk-detail-input', type: 'text' });
  titleInput.value = t.text || '';
  titleInput.addEventListener('change', () => h.onUpdateField(t.id, { text: titleInput.value.trim() || t.text }));
  titleInput.addEventListener('keydown', e => {
    stop(e);
    if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
  });

  // ---- Description ----
  const descSection = detail.createDiv('wk-detail-section');
  descSection.createDiv({ cls: 'wk-detail-label', text: 'Description' });
  const descArea = descSection.createEl('textarea', { cls: 'wk-detail-textarea' });
  descArea.value = t.description || '';
  descArea.placeholder = 'Notes, context, links — anything you want to remember about this task.';
  descArea.rows = 4;
  descArea.addEventListener('change', () => h.onUpdateField(t.id, { description: descArea.value }));
  descArea.addEventListener('keydown', stop);

  // ---- 4-column property row: priority / due / start / recurrence ----
  const propsRow = detail.createDiv('wk-detail-props');

  const priCol = propsRow.createDiv('wk-detail-prop');
  priCol.createDiv({ cls: 'wk-detail-label', text: 'Priority' });
  const priPills = priCol.createDiv('wk-detail-pri-pills');
  for (const p of [1, 2, 3, 4]) {
    const pill = priPills.createSpan({ cls: `wk-detail-pri-pill wk-pri-${p}`, text: `P${p}` });
    if (t.priority === p) pill.addClass('wk-detail-pri-pill-active');
    pill.addEventListener('click', () => h.onUpdateField(t.id, { priority: t.priority === p ? undefined : p }));
  }
  const priClear = priPills.createSpan({ cls: 'wk-detail-pri-pill wk-detail-pri-clear', text: '-' });
  priClear.setAttribute('title', 'Clear priority');
  if (!t.priority) priClear.addClass('wk-detail-pri-pill-active');
  priClear.addEventListener('click', () => h.onUpdateField(t.id, { priority: undefined }));

  const dueCol = propsRow.createDiv('wk-detail-prop');
  dueCol.createDiv({ cls: 'wk-detail-label', text: 'Due' });
  const dueInput = dueCol.createEl('input', { cls: 'wk-detail-input', type: 'date' });
  dueInput.value = t.due || '';
  dueInput.addEventListener('change', () => h.onUpdateField(t.id, { due: dueInput.value || undefined }));
  dueInput.addEventListener('keydown', stop);

  const startCol = propsRow.createDiv('wk-detail-prop');
  startCol.createDiv({ cls: 'wk-detail-label', text: 'Start' });
  const startInput = startCol.createEl('input', { cls: 'wk-detail-input', type: 'date' });
  startInput.value = t.scheduled || '';
  startInput.addEventListener('change', () => h.onUpdateField(t.id, { scheduled: startInput.value || undefined }));
  startInput.addEventListener('keydown', stop);

  const recurCol = propsRow.createDiv('wk-detail-prop');
  recurCol.createDiv({ cls: 'wk-detail-label', text: 'Recurrence' });
  const recurSelect = recurCol.createEl('select', { cls: 'wk-detail-input wk-detail-select' });
  const recurOptions = [
    ['', 'None'],
    ['day', 'Every day'],
    ['week', 'Every week'],
    ['month', 'Every month'],
    ['year', 'Every year'],
    ['monday', 'Every Monday'],
    ['tuesday', 'Every Tuesday'],
    ['wednesday', 'Every Wednesday'],
    ['thursday', 'Every Thursday'],
    ['friday', 'Every Friday'],
    ['saturday', 'Every Saturday'],
    ['sunday', 'Every Sunday'],
  ];
  let recurMatched = false;
  for (const [val, label] of recurOptions) {
    const opt = recurSelect.createEl('option', { text: label, attr: { value: val } });
    if ((t.recurrence || '') === val) { opt.selected = true; recurMatched = true; }
  }
  if (t.recurrence && !recurMatched) {
    const opt = recurSelect.createEl('option', { text: `Every ${t.recurrence}`, attr: { value: t.recurrence } });
    opt.selected = true;
  }
  recurSelect.addEventListener('change', () => h.onUpdateField(t.id, { recurrence: recurSelect.value || undefined }));
  recurSelect.addEventListener('keydown', stop);

  // ---- Project ----
  const projSection = detail.createDiv('wk-detail-section');
  projSection.createDiv({ cls: 'wk-detail-label', text: 'Project' });
  const projSelect = projSection.createEl('select', { cls: 'wk-detail-input wk-detail-select' });
  projSelect.createEl('option', { text: 'Inbox (no project)', attr: { value: '' } });
  for (const p of store.allProjects()) {
    const opt = projSelect.createEl('option', { text: p.name, attr: { value: p.id } });
    if (t.project === p.id) opt.selected = true;
  }
  for (const p of store.archivedProjects()) {
    const opt = projSelect.createEl('option', { text: `${p.name} (archived)`, attr: { value: p.id } });
    if (t.project === p.id) opt.selected = true;
  }
  projSelect.addEventListener('change', () => h.onUpdateField(t.id, { project: projSelect.value || null }));
  projSelect.addEventListener('keydown', stop);

  // ---- Tags ----
  const tagsSection = detail.createDiv('wk-detail-section');
  tagsSection.createDiv({ cls: 'wk-detail-label', text: 'Tags' });
  const tagsRow = tagsSection.createDiv('wk-detail-chips');
  for (const tag of t.tags || []) {
    const chip = tagsRow.createSpan('wk-detail-chip wk-detail-chip-tag');
    chip.createSpan({ text: '#' + tag });
    const x = chip.createSpan({ cls: 'wk-detail-chip-x', text: 'x' });
    x.setAttribute('title', 'Remove tag');
    x.addEventListener('click', e => {
      e.stopPropagation();
      h.onUpdateField(t.id, { tags: (t.tags || []).filter(x => x !== tag) });
    });
  }
  const tagInput = tagsRow.createEl('input', { cls: 'wk-detail-chip-input', type: 'text' });
  tagInput.placeholder = '+ tag (Enter)';
  tagInput.addEventListener('keydown', e => {
    stop(e);
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = tagInput.value.trim().replace(/^#/, '');
      if (val && !(t.tags || []).includes(val)) {
        h.onUpdateField(t.id, { tags: [...(t.tags || []), val] });
      }
      tagInput.value = '';
    }
  });

  // ---- Linked notes ----
  const linksSection = detail.createDiv('wk-detail-section');
  linksSection.createDiv({ cls: 'wk-detail-label', text: 'Linked notes' });
  const linksRow = linksSection.createDiv('wk-detail-chips');
  for (const link of t.links || []) {
    const chip = linksRow.createSpan('wk-detail-chip wk-detail-chip-link');
    const linkText = chip.createSpan({ cls: 'wk-detail-chip-link-text', text: `[[${link}]]` });
    linkText.addEventListener('click', () => h.onOpenLinkByName(link));
    const x = chip.createSpan({ cls: 'wk-detail-chip-x', text: 'x' });
    x.setAttribute('title', 'Remove link');
    x.addEventListener('click', e => {
      e.stopPropagation();
      h.onUpdateField(t.id, { links: (t.links || []).filter(x => x !== link) });
    });
  }
  const linkInput = linksRow.createEl('input', { cls: 'wk-detail-chip-input', type: 'text' });
  linkInput.placeholder = '+ Note name (Enter)';
  linkInput.addEventListener('keydown', e => {
    stop(e);
    if (e.key === 'Enter') {
      e.preventDefault();
      let val = linkInput.value.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
      if (val && !(t.links || []).includes(val)) {
        h.onUpdateField(t.id, { links: [...(t.links || []), val] });
      }
      linkInput.value = '';
    }
  });

  // ---- Read-only metadata ----
  const metaSection = detail.createDiv('wk-detail-section wk-detail-meta');
  if (t.createdAt) {
    metaSection.createSpan({ cls: 'wk-detail-meta-k', text: 'Created' });
    metaSection.createSpan({ cls: 'wk-detail-meta-v', text: t.createdAt.slice(0, 10) });
  }
  if (t.completed && t.completionDate) {
    metaSection.createSpan({ cls: 'wk-detail-meta-k', text: 'Completed' });
    metaSection.createSpan({ cls: 'wk-detail-meta-v', text: t.completionDate });
  }
  metaSection.createSpan({ cls: 'wk-detail-meta-k', text: 'ID' });
  metaSection.createSpan({ cls: 'wk-detail-meta-v', text: t.id });

  // ---- Action buttons ----
  const actions = detail.createDiv('wk-detail-actions');
  if (t.links && t.links.length > 0) {
    const openBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Open linked note' });
    openBtn.addEventListener('click', () => h.onOpenLinkByName(t.links[0]));
  }
  const completeBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: t.completed ? 'Mark incomplete' : 'Mark complete' });
  completeBtn.addEventListener('click', () => h.onToggle(t.id));

  const collapseBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Close' });
  collapseBtn.addEventListener('click', () => h.onCollapseDetail(t.id));

  const spacer = actions.createDiv('wk-spacer');

  const deleteBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-danger', text: 'Delete task' });
  deleteBtn.addEventListener('click', () => h.onDeleteOne(t.id));
}

function renderBody(body, visible, state, store, h) {
  body.empty();
  if (visible.length === 0) {
    const empty = body.createDiv('wk-empty');
    if (state.search) {
      empty.setText('No tasks match your search.');
    } else if (state.activeView.kind === 'logbook') {
      empty.setText('Nothing in your logbook yet. Completed tasks will appear here, grouped by date.');
    } else {
      empty.setText(`No tasks yet. Press ${MOD}+Shift+T or click "+ New task" to add one.`);
    }
    return;
  }
  const { groupBy, sortBy } = resolveGrouping(state.activeView, state);
  const groups = groupTodos(visible, groupBy, store);
  sortInGroups(groups, sortBy, groupBy);
  for (const [name, todos] of groups) {
    const isCollapsed = state.collapsedGroups.has(name);
    const header = body.createDiv('wk-group-header');
    if (isCollapsed) header.addClass('wk-group-collapsed');
    header.createSpan('wk-caret');
    header.createSpan({ text: name });
    header.createSpan({ cls: 'wk-count', text: String(todos.length) });
    header.addEventListener('click', () => h.onToggleGroup(name));
    header.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      h.onContextGroup(e, name);
    });
    if (isCollapsed) continue;
    for (const t of todos) {
      renderRow(body, t, state, store, h);
      if (state.expandedId === t.id) renderDetail(body, t, state, store, h);
    }
  }
}

function renderStatusBar(sb, state, store, visible) {
  sb.empty();
  sb.classList.toggle('wk-statusbar-selection', state.selected.size > 0);
  const overdue = visible.filter(t => t.due && isOverdue(t.due) && !t.completed).length;

  sb.createSpan({ text: `${visible.length} task${visible.length === 1 ? '' : 's'}` });
  if (state.selected.size > 0) {
    sb.createSpan({ cls: 'wk-sep', text: '·' });
    sb.createSpan({ cls: 'wk-sel-count', text: `${state.selected.size} selected` });
  }
  if (overdue > 0) {
    sb.createSpan({ cls: 'wk-sep', text: '·' });
    sb.createSpan({ cls: 'wk-overdue', text: `${overdue} overdue` });
  }
  sb.createDiv('wk-spacer');

  const hints = [
    ['j/k', 'nav'],
    ['x', 'toggle'],
    ['e', 'edit'],
    ['Space', 'peek'],
    ['Enter', 'open'],
    ['z', 'undo'],
    [`${MOD}+K`, 'palette'],
  ];
  for (const [k, label] of hints) {
    const wrap = sb.createSpan();
    wrap.createSpan({ cls: 'wk-kbd', text: k });
    wrap.appendText(' ' + label);
  }
}

function renderView(refs, state, store, h) {
  const visible = applyView(store.all(), state.activeView, state.search, state.showCompleted);
  renderToolbar(refs.toolbar, state, store, h);
  renderSidebar(refs.sidebar, state, store, h);
  renderBody(refs.body, visible, state, store, h);
  renderStatusBar(refs.statusbar, state, store, visible);
  return visible;
}

// ============================================================
// Command palette
// ============================================================

class CommandPalette extends Modal {
  constructor(app, host) {
    super(app);
    this.host = host;
    this.isOpen = false;
    this.selected = 0;
    this.filtered = [];
  }

  open() {
    this.isOpen = true;
    super.open();
  }

  onOpen() {
    this.modalEl.addClass('wk-palette-modal');
    this.contentEl.empty();
    this.input = this.contentEl.createEl('input', { cls: 'wk-palette-input', type: 'text' });
    this.input.placeholder = this.host.selectionSize() > 0
      ? `Acting on ${this.host.selectionSize()} selected — type a command...`
      : 'Type a command, search a task, or jump to a view...';
    this.resultsEl = this.contentEl.createDiv('wk-palette-results');
    this.selected = 0;
    this.render('');
    this.input.addEventListener('input', () => { this.selected = 0; this.render(this.input.value); });
    this.input.addEventListener('keydown', e => this.handleKey(e));
    setTimeout(() => this.input.focus(), 50);
  }

  onClose() {
    this.isOpen = false;
    this.contentEl.empty();
  }

  buildCommands() {
    const host = this.host;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const projects = host.getProjects();

    const projectViewCommands = projects.map(p => ({
      section: 'View',
      label: `View: ${p.name}`,
      run: () => host.applyView({ kind: 'project', ref: p.id }),
    }));
    const projectMoveCommands = projects.map(p => ({
      section: 'Project',
      label: `Move to: ${p.name}`,
      run: () => host.moveSelectedToProject(p.id),
    }));

    return [
      { section: 'Task',     label: 'New task',                       kbd: `${MOD}+Shift+T`, run: () => host.openQuickAdd() },

      { section: 'View',     label: 'View: All Active',                                       run: () => host.applyView({ kind: 'all' }) },
      { section: 'View',     label: 'View: Today',                                            run: () => host.applyView({ kind: 'today' }) },
      { section: 'View',     label: 'View: Overdue',                                          run: () => host.applyView({ kind: 'overdue' }) },
      { section: 'View',     label: 'View: This Week',                                        run: () => host.applyView({ kind: 'thisWeek' }) },
      { section: 'View',     label: 'View: No Date',                                          run: () => host.applyView({ kind: 'noDate' }) },
      { section: 'View',     label: 'View: Inbox',                                            run: () => host.applyView({ kind: 'inbox' }) },
      { section: 'View',     label: 'View: Logbook (completed history)',                      run: () => host.applyView({ kind: 'logbook' }) },
      ...projectViewCommands,

      { section: 'Action',   label: 'Toggle complete',                kbd: 'X',               run: () => host.toggleSelected() },
      { section: 'Action',   label: 'Edit text inline',               kbd: 'E',               run: () => host.startEditCursor() },
      { section: 'Action',   label: 'Toggle detail pane',             kbd: 'Space',           run: () => host.toggleDetailCursor() },
      { section: 'Action',   label: 'Open linked note',               kbd: 'Enter',           run: () => host.openRefCursor() },
      { section: 'Action',   label: 'Move up',                        kbd: 'Shift+K',         run: () => host.moveUp() },
      { section: 'Action',   label: 'Move down',                      kbd: 'Shift+J',         run: () => host.moveDown() },
      { section: 'Action',   label: 'Delete task',                    kbd: 'Del',             run: () => host.deleteSelected() },

      { section: 'Project',  label: 'New project...',                                         run: () => host.openNewProject() },
      ...projectMoveCommands,
      { section: 'Project',  label: 'Move to: Inbox (no project)',                            run: () => host.moveSelectedToProject(null) },
      { section: 'Project',  label: 'Rename current project...',                              run: () => host.openRenameCurrentProject() },
      { section: 'Project',  label: 'Archive current project',                                run: () => host.archiveCurrentProject() },
      {
        section: 'Project',
        label: host.isShowingArchivedProjects() ? 'Hide archived projects' : 'Show archived projects',
        run: () => host.toggleShowArchivedProjects(),
      },

      { section: 'Priority', label: 'Priority: P1 (urgent)',          kbd: '1',               run: () => host.setPrioritySelected(1) },
      { section: 'Priority', label: 'Priority: P2',                   kbd: '2',               run: () => host.setPrioritySelected(2) },
      { section: 'Priority', label: 'Priority: P3',                   kbd: '3',               run: () => host.setPrioritySelected(3) },
      { section: 'Priority', label: 'Priority: P4 (low)',             kbd: '4',               run: () => host.setPrioritySelected(4) },
      { section: 'Priority', label: 'Clear priority',                                         run: () => host.setPrioritySelected(null) },

      { section: 'Schedule', label: 'Set due: Today',                                         run: () => host.setDueSelected(today()) },
      { section: 'Schedule', label: 'Set due: Tomorrow',                                      run: () => host.setDueSelected(fmtDate(tomorrow)) },
      { section: 'Schedule', label: 'Set due: Next Monday',                                   run: () => host.setDueSelected(nextWeekday('mon')) },
      { section: 'Schedule', label: 'Set due: Next Friday',                                   run: () => host.setDueSelected(nextWeekday('fri')) },
      { section: 'Schedule', label: 'Clear due date',                                         run: () => host.setDueSelected(null) },
      { section: 'Schedule', label: 'Recurrence: every day',                                  run: () => host.setRecurrenceSelected('day') },
      { section: 'Schedule', label: 'Recurrence: every week',                                 run: () => host.setRecurrenceSelected('week') },
      { section: 'Schedule', label: 'Recurrence: every monday',                               run: () => host.setRecurrenceSelected('monday') },
      { section: 'Schedule', label: 'Recurrence: every month',                                run: () => host.setRecurrenceSelected('month') },
      { section: 'Schedule', label: 'Clear recurrence',                                       run: () => host.setRecurrenceSelected(null) },

      { section: 'Layout',   label: 'Group by: Project',                                      run: () => host.setGroupBy('project') },
      { section: 'Layout',   label: 'Group by: Priority',                                     run: () => host.setGroupBy('priority') },
      { section: 'Layout',   label: 'Group by: Due date',                                     run: () => host.setGroupBy('due') },
      { section: 'Layout',   label: 'Group by: Tag',                                          run: () => host.setGroupBy('tag') },
      { section: 'Layout',   label: 'Group by: None',                                         run: () => host.setGroupBy('none') },
      { section: 'Layout',   label: 'Sort by: Priority',                                      run: () => host.setSortBy('priority') },
      { section: 'Layout',   label: 'Sort by: Due date',                                      run: () => host.setSortBy('due') },
      { section: 'Layout',   label: 'Sort by: Manual order',                                  run: () => host.setSortBy('manual') },
      { section: 'Layout',   label: 'Sort by: Created',                                       run: () => host.setSortBy('created') },
      {
        section: 'Layout',
        label: host.isShowingCompleted() ? 'Hide completed tasks' : 'Show completed tasks',
        run: () => host.toggleShowCompleted(),
      },
    ];
  }

  render(query) {
    const q = query.toLowerCase().trim();
    const all = this.buildCommands();
    this.filtered = q ? all.filter(c => c.label.toLowerCase().includes(q)) : all;
    this.resultsEl.empty();
    if (this.filtered.length === 0) {
      this.resultsEl.createDiv('wk-palette-empty').setText('No matching commands');
      return;
    }
    let lastSection = null;
    this.filtered.forEach((c, i) => {
      if (c.section !== lastSection) {
        this.resultsEl.createDiv('wk-palette-section').setText(c.section);
        lastSection = c.section;
      }
      const item = this.resultsEl.createDiv('wk-palette-item');
      if (i === this.selected) item.addClass('wk-palette-item-sel');
      item.createSpan({ cls: 'wk-palette-label', text: c.label });
      if (c.kbd) item.createSpan({ cls: 'wk-palette-kbd', text: c.kbd });
      item.addEventListener('click', () => this.execute(c));
      item.addEventListener('mouseenter', () => {
        this.selected = i;
        this.refreshSelection();
      });
    });
  }

  handleKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selected = Math.min(this.filtered.length - 1, this.selected + 1);
      this.refreshSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selected = Math.max(0, this.selected - 1);
      this.refreshSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = this.filtered[this.selected];
      if (c) this.execute(c);
    }
  }

  refreshSelection() {
    const items = this.resultsEl.querySelectorAll('.wk-palette-item');
    items.forEach((el, j) => el.classList.toggle('wk-palette-item-sel', j === this.selected));
    items[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  execute(cmd) {
    this.close();
    setTimeout(() => cmd.run(), 60);
  }
}

// ============================================================
// Quick add modal
// ============================================================

class QuickAddModal extends Modal {
  constructor(app, plugin, defaultProjectId) {
    super(app);
    this.plugin = plugin;
    this.defaultProjectId = defaultProjectId ?? null;
  }

  onOpen() {
    this.modalEl.addClass('wk-quickadd-modal');
    this.contentEl.empty();

    const header = this.contentEl.createDiv('wk-qa-header');
    header.createDiv({ cls: 'wk-qa-title', text: 'New task' });

    const projectName = this.defaultProjectId
      ? (this.plugin.store.projectById(this.defaultProjectId)?.name || 'Inbox')
      : 'Inbox';
    header.createDiv({ cls: 'wk-qa-subtitle', text: `Will be added to: ${projectName}` });

    const inputWrap = this.contentEl.createDiv('wk-qa-input-wrap');
    const input = inputWrap.createEl('input', { cls: 'wk-qa-input', type: 'text' });
    input.placeholder = 'What needs doing?';

    const previewWrap = this.contentEl.createDiv('wk-qa-preview');
    previewWrap.createDiv({ cls: 'wk-qa-section-label', text: 'Preview' });
    const previewBody = previewWrap.createDiv('wk-qa-preview-body');

    const cheatWrap = this.contentEl.createDiv('wk-qa-cheat');
    cheatWrap.createDiv({ cls: 'wk-qa-section-label', text: 'Syntax' });
    const cheatRow = cheatWrap.createDiv('wk-qa-cheat-row');
    const cheats = [
      ['today',          'due today'],
      ['tomorrow',       'due tomorrow'],
      ['due:2026-05-01', 'specific date'],
      ['!1 - !4',        'priority'],
      ['#tag',           'tag'],
      ['[[Note]]',       'link a note'],
      ['every:week',     'recurrence'],
    ];
    for (const [token, desc] of cheats) {
      const chip = cheatRow.createSpan('wk-qa-chip');
      chip.createSpan({ cls: 'wk-qa-chip-token', text: token });
      chip.createSpan({ cls: 'wk-qa-chip-desc', text: desc });
    }

    const actions = this.contentEl.createDiv('wk-qa-actions');
    const cancelBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Cancel' });
    const addBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-primary' });
    addBtn.createSpan({ text: 'Add task' });
    addBtn.createSpan({ cls: 'wk-qa-btn-kbd', text: 'Enter' });

    const renderPreview = () => {
      previewBody.empty();
      const raw = input.value.trim();
      if (!raw) {
        previewBody.createDiv({ cls: 'wk-qa-preview-empty', text: 'Start typing to see how your task will look.' });
        addBtn.setAttribute('disabled', 'true');
        return;
      }
      addBtn.removeAttribute('disabled');
      const parsed = parseTodoText(raw);

      const row = previewBody.createDiv('wk-qa-preview-row');
      row.createDiv('wk-check');

      const meta = row.createDiv('wk-qa-preview-meta');
      meta.createDiv({ cls: 'wk-qa-preview-title', text: parsed.text || '(no description)' });

      const sub = meta.createDiv('wk-qa-preview-sub');
      let added = false;
      if (parsed.priority) {
        sub.createSpan({ cls: `wk-cell-pri wk-pri-${parsed.priority}`, text: `P${parsed.priority}` });
        added = true;
      }
      if (parsed.due) {
        const dueChip = sub.createSpan({ cls: 'wk-due', text: formatDue(parsed.due, this.plugin.data.dateFormat) });
        if (isToday(parsed.due)) dueChip.addClass('wk-due-today');
        else if (isOverdue(parsed.due)) dueChip.addClass('wk-due-overdue');
        added = true;
      }
      if (parsed.recurrence) {
        sub.createSpan({ cls: 'wk-rec', text: 'every ' + parsed.recurrence });
        added = true;
      }
      for (const tag of parsed.tags) {
        sub.createSpan({ cls: 'wk-tag', text: tag });
        added = true;
      }
      for (const link of parsed.links) {
        sub.createSpan({ cls: 'wk-ref-link wk-qa-preview-link', text: `[[${link}]]` });
        added = true;
      }
      if (!added) sub.createSpan({ cls: 'wk-qa-preview-hint', text: 'no metadata yet' });
    };

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      const t = await this.plugin.store.add(text, this.defaultProjectId);
      new Notice(`Added: ${t.text}`);
      this.close();
    };

    input.addEventListener('input', renderPreview);
    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') this.close();
    });
    addBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => this.close());

    renderPreview();
    setTimeout(() => input.focus(), 50);
  }
}

// ============================================================
// Project modals
// ============================================================

class NewProjectModal extends Modal {
  constructor(app, plugin, onCreated) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
    this.selectedColor = PROJECT_COLORS[0];
  }

  onOpen() {
    this.modalEl.addClass('wk-project-modal');
    this.contentEl.empty();

    const header = this.contentEl.createDiv('wk-qa-header');
    header.createDiv({ cls: 'wk-qa-title', text: 'New project' });

    const nameWrap = this.contentEl.createDiv('wk-qa-input-wrap');
    nameWrap.createDiv({ cls: 'wk-qa-section-label', text: 'Name' });
    const input = nameWrap.createEl('input', { cls: 'wk-qa-input', type: 'text' });
    input.placeholder = 'House Renovation';

    const colorWrap = this.contentEl.createDiv('wk-pj-colors-wrap');
    colorWrap.createDiv({ cls: 'wk-qa-section-label', text: 'Color' });
    const colorRow = colorWrap.createDiv('wk-pj-colors');
    const swatches = [];
    for (const c of PROJECT_COLORS) {
      const s = colorRow.createDiv('wk-pj-swatch');
      s.style.background = c;
      if (c === this.selectedColor) s.addClass('wk-pj-swatch-active');
      s.addEventListener('click', () => {
        this.selectedColor = c;
        swatches.forEach(x => x.classList.remove('wk-pj-swatch-active'));
        s.classList.add('wk-pj-swatch-active');
      });
      swatches.push(s);
    }

    const actions = this.contentEl.createDiv('wk-qa-actions');
    const cancelBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Cancel' });
    const createBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-primary' });
    createBtn.createSpan({ text: 'Create project' });
    createBtn.createSpan({ cls: 'wk-qa-btn-kbd', text: 'Enter' });
    createBtn.setAttribute('disabled', 'true');

    const submit = async () => {
      const name = input.value.trim();
      if (!name) return;
      const p = await this.plugin.store.createProject(name, this.selectedColor);
      this.close();
      if (this.onCreated) this.onCreated(p);
    };

    input.addEventListener('input', () => {
      if (input.value.trim()) createBtn.removeAttribute('disabled');
      else createBtn.setAttribute('disabled', 'true');
    });
    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') this.close();
    });
    createBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => this.close());

    setTimeout(() => input.focus(), 50);
  }
}

class RenameProjectModal extends Modal {
  constructor(app, plugin, project) {
    super(app);
    this.plugin = plugin;
    this.project = project;
  }

  onOpen() {
    this.modalEl.addClass('wk-project-modal');
    this.contentEl.empty();

    const header = this.contentEl.createDiv('wk-qa-header');
    header.createDiv({ cls: 'wk-qa-title', text: 'Rename project' });

    const nameWrap = this.contentEl.createDiv('wk-qa-input-wrap');
    nameWrap.createDiv({ cls: 'wk-qa-section-label', text: 'Name' });
    const input = nameWrap.createEl('input', { cls: 'wk-qa-input', type: 'text' });
    input.value = this.project.name;

    const actions = this.contentEl.createDiv('wk-qa-actions');
    const cancelBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Cancel' });
    const saveBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-primary' });
    saveBtn.createSpan({ text: 'Save' });
    saveBtn.createSpan({ cls: 'wk-qa-btn-kbd', text: 'Enter' });

    const submit = async () => {
      const name = input.value.trim();
      if (!name || name === this.project.name) { this.close(); return; }
      await this.plugin.store.renameProject(this.project.id, name);
      this.close();
    };

    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') this.close();
    });
    saveBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => this.close());

    setTimeout(() => { input.focus(); input.select(); }, 50);
  }
}

// ============================================================
// Settings tab
// ============================================================

class WakeSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Wake' });

    // ----------------------------------------------------------
    // General
    // ----------------------------------------------------------
    containerEl.createEl('h3', { text: 'General' });

    new Setting(containerEl)
      .setName('Display density')
      .setDesc('Comfortable shows full padding. Compact fits more tasks in less space.')
      .addDropdown(d => d
        .addOption('comfortable', 'Comfortable')
        .addOption('compact', 'Compact')
        .setValue(this.plugin.data.density)
        .onChange(async v => {
          this.plugin.data.density = v;
          await this.plugin.save();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName('Date format')
      .setDesc('How due dates display in the task list. Date pickers always use ISO regardless.')
      .addDropdown(d => d
        .addOption('short', 'Short  (Today / Tomorrow / 05-01)')
        .addOption('long',  'Long   (May 1)')
        .addOption('iso',   'ISO    (2026-05-01)')
        .addOption('relative', 'Relative (in 2 days)')
        .setValue(this.plugin.data.dateFormat)
        .onChange(async v => {
          this.plugin.data.dateFormat = v;
          await this.plugin.save();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName('New tasks default to')
      .setDesc('Where Quick Add lands when you press Cmd+Shift+T.')
      .addDropdown(d => d
        .addOption('currentView', "Current view's project (Inbox if not in a project)")
        .addOption('inbox',       'Inbox always')
        .setValue(this.plugin.data.newTaskDefault)
        .onChange(async v => { this.plugin.data.newTaskDefault = v; await this.plugin.save(); }));

    // ----------------------------------------------------------
    // Sidebar
    // ----------------------------------------------------------
    containerEl.createEl('h3', { text: 'Sidebar' });

    new Setting(containerEl)
      .setName('Show tags section')
      .setDesc('Lists every tag used by an active task. Disable for a cleaner sidebar.')
      .addToggle(t => t
        .setValue(this.plugin.data.showTagsInSidebar)
        .onChange(async v => {
          this.plugin.data.showTagsInSidebar = v;
          await this.plugin.save();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName('Show archived projects')
      .setDesc('Display archived projects below active ones, dimmed.')
      .addToggle(t => t
        .setValue(this.plugin.data.showArchivedProjects)
        .onChange(async v => {
          this.plugin.data.showArchivedProjects = v;
          await this.plugin.save();
          this.plugin.refreshOpenViews();
        }));

    // ----------------------------------------------------------
    // Defaults (fallback group/sort)
    // ----------------------------------------------------------
    containerEl.createEl('h3', { text: 'Defaults' });
    containerEl.createDiv({
      cls: 'setting-item-description',
      text: 'These are the fallback grouping and sorting for views that don\'t have a smart default. Time-based views (Today, This Week, Overdue, Logbook) always use their own smart defaults; you can still override per-view from the toolbar.',
    });

    new Setting(containerEl)
      .setName('Default group by')
      .addDropdown(d => d
        .addOption('project', 'Project')
        .addOption('priority', 'Priority')
        .addOption('due', 'Due date')
        .addOption('tag', 'Tag')
        .addOption('none', 'None')
        .setValue(this.plugin.data.groupBy)
        .onChange(async v => { this.plugin.data.groupBy = v; await this.plugin.save(); this.plugin.refreshOpenViews(); }));

    new Setting(containerEl)
      .setName('Default sort by')
      .addDropdown(d => d
        .addOption('priority', 'Priority')
        .addOption('due', 'Due date')
        .addOption('created', 'Created')
        .addOption('manual', 'Manual order')
        .setValue(this.plugin.data.sortBy)
        .onChange(async v => { this.plugin.data.sortBy = v; await this.plugin.save(); this.plugin.refreshOpenViews(); }));

    new Setting(containerEl)
      .setName('Show completed by default')
      .setDesc('Include completed tasks in non-Logbook views.')
      .addToggle(t => t
        .setValue(this.plugin.data.showCompleted)
        .onChange(async v => { this.plugin.data.showCompleted = v; await this.plugin.save(); this.plugin.refreshOpenViews(); }));

    // Per-view overrides summary + clear
    const overrides = this.plugin.data.viewOverrides || {};
    const overrideKeys = Object.keys(overrides).filter(k => Object.keys(overrides[k] || {}).length > 0);
    if (overrideKeys.length > 0) {
      new Setting(containerEl)
        .setName(`Per-view overrides (${overrideKeys.length})`)
        .setDesc(`These views have their own group/sort: ${overrideKeys.join(', ')}.`)
        .addButton(b => b
          .setButtonText('Clear all overrides')
          .onClick(async () => {
            this.plugin.data.viewOverrides = {};
            await this.plugin.save();
            this.plugin.refreshOpenViews();
            this.display();
          }));
    }

    // ----------------------------------------------------------
    // Data
    // ----------------------------------------------------------
    containerEl.createEl('h3', { text: 'Data' });

    const stats = containerEl.createDiv({ cls: 'setting-item-description' });
    const active = this.plugin.data.todos.filter(t => !t.completed).length;
    const done = this.plugin.data.todos.filter(t => t.completed).length;
    const projActive = this.plugin.data.projects.filter(p => !p.archived).length;
    const projArchived = this.plugin.data.projects.filter(p => p.archived).length;
    stats.createDiv().setText(`Active: ${active}    ·    Logbook: ${done}    ·    Projects: ${projActive}${projArchived ? ` (+ ${projArchived} archived)` : ''}`);
    stats.createDiv().setText('Stored in this plugin\'s data.json. Wake does not scan or modify your markdown notes. Completed tasks are kept permanently as your history.');

    new Setting(containerEl)
      .setName('Export to JSON')
      .setDesc('Download a backup of all tasks, projects, and settings.')
      .addButton(b => b
        .setButtonText('Download backup')
        .onClick(() => this.plugin.exportData()));

    new Setting(containerEl)
      .setName('Reset all data')
      .setDesc('Deletes every task, project, and override. This cannot be undone.')
      .addButton(b => b
        .setButtonText('Reset...')
        .setWarning()
        .onClick(() => new ResetConfirmModal(this.app, this.plugin, () => this.display()).open()));

    // About
    containerEl.createEl('h3', { text: 'About' });
    const about = containerEl.createDiv({ cls: 'setting-item-description' });
    about.createDiv().setText(`Wake v0.6.0 by Real-Fruit-Snacks`);
    about.createDiv().setText('A keyboard-first task manager. Tasks are self-contained; reference vault notes via [[Note]].');
  }
}

// ============================================================
// Wake view
// ============================================================

class WakeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.editingId = null;
    this.undoStack = [];
    this.state = {
      selected: new Set(),
      cursor: null,
      expandedId: null,
      collapsedGroups: new Set(),
      search: '',
      activeView: plugin.data.activeView || { kind: 'all' },
      groupBy: plugin.data.groupBy,
      sortBy: plugin.data.sortBy,
      showCompleted: plugin.data.showCompleted,
      showArchivedProjects: plugin.data.showArchivedProjects,
    };
    this.palette = new CommandPalette(this.app, this);
  }

  getViewType()    { return VIEW_TYPE_WAKE; }
  getDisplayText() { return 'Wake'; }
  getIcon()        { return 'check-circle'; }

  async onOpen() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('wk-root');
    root.tabIndex = -1;

    this.refs = {
      toolbar:   root.createDiv('wk-toolbar'),
    };
    const content = root.createDiv('wk-content');
    this.refs.sidebar = content.createDiv('wk-sidebar');
    this.refs.body = content.createDiv('wk-main');
    this.refs.statusbar = root.createDiv('wk-statusbar');
    this.toastEl = root.createDiv('wk-toast-stack');

    this.render();
    this.unsubscribe = this.plugin.store.subscribe(() => this.render());
    this.registerDomEvent(root, 'keydown', e => this.handleKey(e));
    setTimeout(() => root.focus(), 50);
  }

  async onClose() {
    if (this.unsubscribe) this.unsubscribe();
  }

  render() {
    // Pull settings from plugin.data on each render so settings-tab changes propagate
    // even while a view is already open.
    const d = this.plugin.data;
    this.state.groupBy = d.groupBy;
    this.state.sortBy = d.sortBy;
    this.state.showCompleted = d.showCompleted;
    this.state.showArchivedProjects = d.showArchivedProjects;
    this.state.viewOverrides = d.viewOverrides || {};
    this.state.dateFormat = d.dateFormat || 'short';
    this.state.density = d.density || 'comfortable';
    this.state.showTagsInSidebar = d.showTagsInSidebar !== false;

    // Apply density to the root for CSS hooks.
    const root = this.containerEl.children[1];
    if (root) root.dataset.density = this.state.density;

    const visible = renderView(this.refs, this.state, this.plugin.store, {
      onToggle:         id => this.toggleTodo(id),
      onClickRow:       (id, mods) => this.handleRowClick(id, mods),
      onDoubleClick:    id => this.startEdit(id),
      onSearch:         q => { this.state.search = q; this.render(); },
      onToggleGroup:    name => this.toggleGroup(name),
      onNewTask:        () => this.openQuickAdd(),
      onOpenRef:        id => this.openRef(id),
      onSelectView:     view => this.applyView(view),
      onNewProject:     () => this.openNewProject(),
      onOpenGroupMenu:  e => this.openGroupMenu(e),
      onOpenSortMenu:   e => this.openSortMenu(e),
      onUpdateField:    (id, change) => this.plugin.store.update(id, change),
      onOpenLinkByName: name => this.openLinkByName(name),
      onCollapseDetail: id => this.toggleDetail(id),
      onDeleteOne:      id => this.deleteOne(id),
      onContextRow:     (e, id) => this.openRowContextMenu(e, id),
      onContextProject: (e, pid) => this.openProjectContextMenu(e, pid),
      onContextGroup:   (e, name) => this.openGroupContextMenu(e, name),
    });
    if (visible.length > 0 && (!this.state.cursor || !visible.find(t => t.id === this.state.cursor))) {
      this.state.cursor = visible[0].id;
      const row = this.refs.body.querySelector(`[data-todo-id="${CSS.escape(visible[0].id)}"]`);
      row?.classList.add('wk-cursor');
    }
  }

  getVisible() { return applyView(this.plugin.store.all(), this.state.activeView, this.state.search, this.state.showCompleted); }
  getTodo(id)  { return this.plugin.store.byId(id); }
  getProjects(){ return this.plugin.store.allProjects(); }

  applyView(view) {
    this.state.activeView = view;
    this.plugin.data.activeView = view;
    this.plugin.save();
    this.render();
  }

  selectionSize()             { return this.state.selected.size; }
  isShowingCompleted()        { return this.state.showCompleted; }
  isShowingArchivedProjects() { return this.state.showArchivedProjects; }

  toggleShowArchivedProjects() {
    this.state.showArchivedProjects = !this.state.showArchivedProjects;
    this.plugin.data.showArchivedProjects = this.state.showArchivedProjects;
    this.plugin.save();
    this.render();
  }

  startEditCursor()  { if (this.state.cursor) this.startEdit(this.state.cursor); }
  toggleDetailCursor() { if (this.state.cursor) this.toggleDetail(this.state.cursor); }
  openRefCursor()    { if (this.state.cursor) this.openRef(this.state.cursor); }

  // Per-view group/sort overrides — store in data.viewOverrides[view.kind].
  // The toolbar always reflects the resolved value (override > smart default > global).
  setGroupBy(val) {
    const key = this.state.activeView.kind;
    if (!this.plugin.data.viewOverrides) this.plugin.data.viewOverrides = {};
    if (!this.plugin.data.viewOverrides[key]) this.plugin.data.viewOverrides[key] = {};
    this.plugin.data.viewOverrides[key].groupBy = val;
    this.plugin.save();
    this.render();
  }
  setSortBy(val) {
    const key = this.state.activeView.kind;
    if (!this.plugin.data.viewOverrides) this.plugin.data.viewOverrides = {};
    if (!this.plugin.data.viewOverrides[key]) this.plugin.data.viewOverrides[key] = {};
    this.plugin.data.viewOverrides[key].sortBy = val;
    this.plugin.save();
    this.render();
  }
  resetViewGroupBy() {
    const key = this.state.activeView.kind;
    if (this.plugin.data.viewOverrides?.[key]) {
      delete this.plugin.data.viewOverrides[key].groupBy;
      this.plugin.save();
      this.render();
    }
  }
  resetViewSortBy() {
    const key = this.state.activeView.kind;
    if (this.plugin.data.viewOverrides?.[key]) {
      delete this.plugin.data.viewOverrides[key].sortBy;
      this.plugin.save();
      this.render();
    }
  }

  openGroupMenu(e) {
    const { groupBy } = resolveGrouping(this.state.activeView, this.state);
    const isOverridden = hasViewOverride(this.state.activeView, this.state, 'groupBy');
    const menu = new Menu();
    const options = [
      ['project',  'Project'],
      ['priority', 'Priority'],
      ['due',      'Due date'],
      ['tag',      'Tag'],
      ['none',     'None'],
    ];
    for (const [val, label] of options) {
      menu.addItem(item => item
        .setTitle(label)
        .setChecked(groupBy === val)
        .onClick(() => this.setGroupBy(val)));
    }
    if (isOverridden) {
      menu.addSeparator();
      menu.addItem(item => item
        .setTitle('Reset to default')
        .onClick(() => this.resetViewGroupBy()));
    }
    menu.showAtMouseEvent(e);
  }

  openSortMenu(e) {
    const { sortBy } = resolveGrouping(this.state.activeView, this.state);
    const isOverridden = hasViewOverride(this.state.activeView, this.state, 'sortBy');
    const menu = new Menu();
    const options = [
      ['priority', 'Priority'],
      ['due',      'Due date'],
      ['created',  'Created'],
      ['manual',   'Manual order'],
    ];
    for (const [val, label] of options) {
      menu.addItem(item => item
        .setTitle(label)
        .setChecked(sortBy === val)
        .onClick(() => this.setSortBy(val)));
    }
    if (isOverridden) {
      menu.addSeparator();
      menu.addItem(item => item
        .setTitle('Reset to default')
        .onClick(() => this.resetViewSortBy()));
    }
    menu.showAtMouseEvent(e);
  }

  // ---- Right-click context menus ----

  openRowContextMenu(e, id) {
    const t = this.getTodo(id);
    if (!t) return;

    // If the right-clicked task isn't part of the current selection,
    // swap selection to just this task (standard desktop behavior).
    if (!this.state.selected.has(id)) {
      this.state.selected = new Set([id]);
      this.state.cursor = id;
      this.render();
    }
    const targetIds = [...this.state.selected];
    const bulk = targetIds.length > 1;

    const menu = new Menu();

    menu.addItem(item => item
      .setTitle(bulk ? `Toggle ${targetIds.length} complete` : (t.completed ? 'Mark incomplete' : 'Mark complete'))
      .onClick(() => this.toggleSelected()));

    if (!bulk) {
      menu.addItem(item => item.setTitle('Edit text inline').onClick(() => this.startEdit(id)));
      menu.addItem(item => item.setTitle('Toggle detail pane').onClick(() => this.toggleDetail(id)));
      if (t.links && t.links.length > 0) {
        menu.addItem(item => item.setTitle('Open linked note').onClick(() => this.openRef(id)));
      }
      menu.addItem(item => item.setTitle('Duplicate').onClick(() => this.duplicateTask(id)));
    }

    menu.addSeparator();

    // Snooze submenu
    menu.addItem(item => {
      item.setTitle('Snooze');
      const sub = item.setSubmenu();
      sub.addItem(s => s.setTitle('Tomorrow').onClick(() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        this.setDueSelected(fmtDate(d));
      }));
      sub.addItem(s => s.setTitle('In 3 days').onClick(() => {
        const d = new Date(); d.setDate(d.getDate() + 3);
        this.setDueSelected(fmtDate(d));
      }));
      sub.addItem(s => s.setTitle('Next Monday').onClick(() => this.setDueSelected(nextWeekday('mon'))));
      sub.addItem(s => s.setTitle('In a week').onClick(() => {
        const d = new Date(); d.setDate(d.getDate() + 7);
        this.setDueSelected(fmtDate(d));
      }));
    });

    // Priority submenu
    menu.addItem(item => {
      item.setTitle('Set priority');
      const sub = item.setSubmenu();
      const labels = { 1: 'P1 (urgent)', 2: 'P2', 3: 'P3', 4: 'P4 (low)' };
      for (const p of [1, 2, 3, 4]) {
        sub.addItem(s => {
          s.setTitle(labels[p]).onClick(() => this.setPrioritySelected(p));
          if (!bulk && t.priority === p) s.setChecked(true);
        });
      }
      sub.addSeparator();
      sub.addItem(s => s.setTitle('Clear priority').onClick(() => this.setPrioritySelected(null)));
    });

    // Due submenu
    menu.addItem(item => {
      item.setTitle('Set due date');
      const sub = item.setSubmenu();
      sub.addItem(s => s.setTitle('Today').onClick(() => this.setDueSelected(today())));
      sub.addItem(s => s.setTitle('Tomorrow').onClick(() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        this.setDueSelected(fmtDate(d));
      }));
      sub.addItem(s => s.setTitle('Next Monday').onClick(() => this.setDueSelected(nextWeekday('mon'))));
      sub.addItem(s => s.setTitle('Next Friday').onClick(() => this.setDueSelected(nextWeekday('fri'))));
      sub.addSeparator();
      sub.addItem(s => s.setTitle('Clear due date').onClick(() => this.setDueSelected(null)));
    });

    // Recurrence submenu
    menu.addItem(item => {
      item.setTitle('Set recurrence');
      const sub = item.setSubmenu();
      sub.addItem(s => {
        s.setTitle('None').onClick(() => this.setRecurrenceSelected(null));
        if (!bulk && !t.recurrence) s.setChecked(true);
      });
      const opts = [
        ['day',     'Every day'],
        ['week',    'Every week'],
        ['monday',  'Every Monday'],
        ['month',   'Every month'],
      ];
      for (const [val, label] of opts) {
        sub.addItem(s => {
          s.setTitle(label).onClick(() => this.setRecurrenceSelected(val));
          if (!bulk && t.recurrence === val) s.setChecked(true);
        });
      }
    });

    // Move to project submenu
    menu.addItem(item => {
      item.setTitle('Move to project');
      const sub = item.setSubmenu();
      sub.addItem(s => {
        s.setTitle('Inbox (no project)').onClick(() => this.moveSelectedToProject(null));
        if (!bulk && !t.project) s.setChecked(true);
      });
      const projects = this.plugin.store.allProjects();
      if (projects.length > 0) sub.addSeparator();
      for (const p of projects) {
        sub.addItem(s => {
          s.setTitle(p.name).onClick(() => this.moveSelectedToProject(p.id));
          if (!bulk && t.project === p.id) s.setChecked(true);
        });
      }
    });

    menu.addSeparator();

    menu.addItem(item => item
      .setTitle(bulk ? `Delete ${targetIds.length} tasks` : 'Delete task')
      .onClick(() => this.deleteSelected()));

    menu.showAtMouseEvent(e);
  }

  openProjectContextMenu(e, projectId) {
    const p = this.plugin.store.projectById(projectId);
    if (!p) return;

    const menu = new Menu();
    const all = this.plugin.store.allProjects();
    const idx = all.findIndex(x => x.id === p.id);

    menu.addItem(item => item
      .setTitle('Rename...')
      .onClick(() => new RenameProjectModal(this.app, this.plugin, p).open()));

    menu.addItem(item => {
      item.setTitle('Change color');
      const sub = item.setSubmenu();
      for (const color of PROJECT_COLORS) {
        const label = PROJECT_COLOR_LABELS[color] || color;
        sub.addItem(s => {
          s.setTitle(label).onClick(() => this.plugin.store.setProjectColor(p.id, color));
          if (p.color === color) s.setChecked(true);
        });
      }
    });

    if (!p.archived) {
      menu.addSeparator();
      menu.addItem(item => {
        item.setTitle('Move up').onClick(() => this.plugin.store.moveProject(p.id, -1));
        if (idx === 0) item.setDisabled(true);
      });
      menu.addItem(item => {
        item.setTitle('Move down').onClick(() => this.plugin.store.moveProject(p.id, 1));
        if (idx === all.length - 1) item.setDisabled(true);
      });
    }

    menu.addSeparator();

    if (p.archived) {
      menu.addItem(item => item
        .setTitle('Unarchive')
        .onClick(() => this.plugin.store.unarchiveProject(p.id)));
    } else {
      menu.addItem(item => item
        .setTitle('Archive (keeps tasks)')
        .onClick(async () => {
          await this.plugin.store.archiveProject(p.id);
          if (this.state.activeView.kind === 'project' && this.state.activeView.ref === p.id) {
            this.applyView({ kind: 'all' });
          }
          this.toast(`Archived "${p.name}"`);
        }));
    }

    menu.addSeparator();

    menu.addItem(item => item
      .setTitle('Delete project...')
      .onClick(async () => {
        const taskCount = this.plugin.store.todos.filter(t => t.project === p.id).length;
        const msg = taskCount > 0
          ? `Delete project "${p.name}"? ${taskCount} task(s) will be moved to Inbox.`
          : `Delete project "${p.name}"?`;
        if (!confirm(msg)) return;
        await this.plugin.store.deleteProject(p.id);
        if (this.state.activeView.kind === 'project' && this.state.activeView.ref === p.id) {
          this.applyView({ kind: 'all' });
        }
        this.toast(`Deleted "${p.name}"${taskCount > 0 ? `; ${taskCount} task(s) moved to Inbox` : ''}`);
      }));

    menu.showAtMouseEvent(e);
  }

  openGroupContextMenu(e, name) {
    const menu = new Menu();
    const isCollapsed = this.state.collapsedGroups.has(name);

    menu.addItem(item => item
      .setTitle(isCollapsed ? 'Expand this group' : 'Collapse this group')
      .onClick(() => this.toggleGroup(name)));

    menu.addSeparator();

    menu.addItem(item => item
      .setTitle('Collapse all groups')
      .onClick(() => this.collapseAllGroups()));

    menu.addItem(item => item
      .setTitle('Expand all groups')
      .onClick(() => { this.state.collapsedGroups.clear(); this.render(); }));

    menu.showAtMouseEvent(e);
  }

  toggleShowCompleted() {
    this.state.showCompleted = !this.state.showCompleted;
    this.plugin.data.showCompleted = this.state.showCompleted;
    this.plugin.save();
    this.render();
  }

  openQuickAdd() {
    let projectId = null;
    if (this.plugin.data.newTaskDefault === 'currentView' && this.state.activeView.kind === 'project') {
      projectId = this.state.activeView.ref;
    }
    new QuickAddModal(this.app, this.plugin, projectId).open();
  }

  openNewProject() {
    new NewProjectModal(this.app, this.plugin, p => {
      this.applyView({ kind: 'project', ref: p.id });
    }).open();
  }

  openRenameCurrentProject() {
    if (this.state.activeView.kind !== 'project') {
      new Notice('Switch to a project first');
      return;
    }
    const p = this.plugin.store.projectById(this.state.activeView.ref);
    if (!p) return;
    new RenameProjectModal(this.app, this.plugin, p).open();
  }

  async archiveCurrentProject() {
    if (this.state.activeView.kind !== 'project') {
      new Notice('Switch to a project first');
      return;
    }
    const p = this.plugin.store.projectById(this.state.activeView.ref);
    if (!p) return;
    await this.plugin.store.archiveProject(p.id);
    this.applyView({ kind: 'all' });
    this.toast(`Archived "${p.name}". Tasks remain assigned.`);
  }

  async moveSelectedToProject(projectId) {
    const ids = this.targets();
    if (ids.length === 0) return;
    for (const id of ids) {
      const t = this.getTodo(id);
      if (t) {
        this.undoStack.push({ todoId: id, prev: { project: t.project } });
        await this.plugin.store.moveToProject(id, projectId);
      }
    }
    const projName = projectId ? (this.plugin.store.projectById(projectId)?.name || 'project') : 'Inbox';
    this.toast(`Moved ${ids.length} to ${projName}`, true);
  }

  // ---- Mutations ----

  async toggleTodo(id) {
    const t = this.getTodo(id);
    if (!t) return;
    this.undoStack.push({ todoId: id, prev: { completed: t.completed, completionDate: t.completionDate } });
    const result = await this.plugin.store.toggleComplete(id);
    if (result.recurred) this.toast(`Completed; next due ${result.nextDate}`, true);
    else this.toast(t.completed ? 'Marked incomplete' : 'Marked complete', true);
  }

  async toggleSelected() {
    const ids = this.targets();
    if (ids.length === 0) return;
    let recurredCount = 0;
    for (const id of ids) {
      const t = this.getTodo(id);
      if (t) {
        this.undoStack.push({ todoId: id, prev: { completed: t.completed, completionDate: t.completionDate } });
        const result = await this.plugin.store.toggleComplete(id);
        if (result.recurred) recurredCount++;
      }
    }
    this.toast(`Toggled ${ids.length}${recurredCount ? `, ${recurredCount} recurring` : ''}`, true);
  }

  async setPrioritySelected(p) {
    const ids = this.targets();
    if (ids.length === 0) return;
    for (const id of ids) {
      const t = this.getTodo(id);
      if (t) {
        this.undoStack.push({ todoId: id, prev: { priority: t.priority } });
        await this.plugin.store.update(id, { priority: p ?? undefined });
      }
    }
    this.toast(p ? `Set priority P${p} on ${ids.length}` : `Cleared priority on ${ids.length}`, true);
  }

  async setDueSelected(date) {
    const ids = this.targets();
    if (ids.length === 0) return;
    for (const id of ids) {
      const t = this.getTodo(id);
      if (t) {
        this.undoStack.push({ todoId: id, prev: { due: t.due } });
        await this.plugin.store.update(id, { due: date ?? undefined });
      }
    }
    this.toast(date ? `Due: ${date}` : 'Cleared due date', true);
  }

  async setRecurrenceSelected(rec) {
    const ids = this.targets();
    if (ids.length === 0) return;
    for (const id of ids) {
      const t = this.getTodo(id);
      if (t) {
        this.undoStack.push({ todoId: id, prev: { recurrence: t.recurrence } });
        await this.plugin.store.update(id, { recurrence: rec ?? undefined });
      }
    }
    this.toast(rec ? `Recurrence: every ${rec}` : 'Cleared recurrence', true);
  }

  async deleteSelected() {
    const ids = this.targets();
    if (ids.length === 0) return;
    // Deletion removes the task entirely. Completed tasks are kept in the logbook;
    // hitting Delete on a completed task will still remove it (user explicit action).
    for (const id of ids) await this.plugin.store.remove(id);
    this.state.selected.clear();
    this.toast(`Deleted ${ids.length}`);
  }

  async moveUp() {
    if (!this.state.cursor) return;
    const moved = await this.plugin.store.move(this.state.cursor, -1);
    if (moved) this.toast('Moved up');
  }
  async moveDown() {
    if (!this.state.cursor) return;
    const moved = await this.plugin.store.move(this.state.cursor, 1);
    if (moved) this.toast('Moved down');
  }

  // ---- Selection / cursor ----

  targets() {
    if (this.state.selected.size > 0) return [...this.state.selected];
    if (this.state.cursor) return [this.state.cursor];
    return [];
  }

  handleRowClick(id, modifiers) {
    const visible = this.getVisible();
    if (modifiers.shift && this.state.cursor) {
      const a = visible.findIndex(t => t.id === this.state.cursor);
      const b = visible.findIndex(t => t.id === id);
      if (a !== -1 && b !== -1) {
        const [from, to] = [Math.min(a, b), Math.max(a, b)];
        for (let i = from; i <= to; i++) this.state.selected.add(visible[i].id);
      }
      this.state.cursor = id;
    } else if (modifiers.meta) {
      if (this.state.selected.has(id)) this.state.selected.delete(id);
      else this.state.selected.add(id);
      this.state.cursor = id;
    } else {
      // Plain click: select + toggle detail pane.
      this.state.selected = new Set([id]);
      this.state.cursor = id;
      this.state.expandedId = (this.state.expandedId === id) ? null : id;
    }
    this.render();
  }

  moveCursor(delta) {
    const visible = this.getVisible();
    if (visible.length === 0) return;
    let idx = this.state.cursor ? visible.findIndex(t => t.id === this.state.cursor) : 0;
    if (idx === -1) idx = 0;
    idx = Math.max(0, Math.min(visible.length - 1, idx + delta));
    this.state.cursor = visible[idx].id;
    this.render();
    const row = this.refs.body.querySelector(`[data-todo-id="${CSS.escape(visible[idx].id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  // ---- Inline edit ----

  startEdit(id) {
    const t = this.getTodo(id);
    if (!t) return;
    const row = this.refs.body.querySelector(`[data-todo-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const cell = row.querySelector('.wk-cell-text');
    if (!cell || cell.tagName === 'INPUT') return;
    this.editingId = id;
    const orig = buildEditableText(t);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wk-cell-text wk-cell-text-editing';
    input.value = orig;
    cell.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      this.editingId = null;
      const newRaw = input.value.trim();
      if (save && newRaw && newRaw !== orig) {
        const cur = this.getTodo(id);
        if (cur) {
          const prev = {
            text: cur.text, priority: cur.priority, due: cur.due, scheduled: cur.scheduled,
            recurrence: cur.recurrence, tags: cur.tags, links: cur.links,
          };
          this.undoStack.push({ todoId: id, prev });
          await this.plugin.store.updateFromRawText(id, newRaw);
        }
      } else {
        this.render();
      }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---- Open referenced note ----

  async openRef(id) {
    const t = this.getTodo(id);
    if (!t || !t.links || t.links.length === 0) {
      new Notice('No linked note for this task');
      return;
    }
    await this.openLinkByName(t.links[0]);
  }

  async openLinkByName(name) {
    const file = this.app.metadataCache.getFirstLinkpathDest(name, '');
    if (!file) {
      new Notice(`Note not found: ${name}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  async deleteOne(id) {
    const t = this.getTodo(id);
    if (!t) return;
    await this.plugin.store.remove(id);
    if (this.state.expandedId === id) this.state.expandedId = null;
    this.state.selected.delete(id);
    this.toast(`Deleted: ${t.text}`);
  }

  async duplicateTask(id) {
    const copy = await this.plugin.store.duplicate(id);
    if (copy) {
      this.state.cursor = copy.id;
      this.state.selected = new Set([copy.id]);
      this.toast(`Duplicated: ${copy.text}`);
    }
  }

  collapseAllGroups() {
    const visible = applyView(
      this.plugin.store.all(),
      this.state.activeView,
      this.state.search,
      this.state.showCompleted,
    );
    const { groupBy } = resolveGrouping(this.state.activeView, this.state);
    const groups = groupTodos(visible, groupBy, this.plugin.store);
    for (const name of groups.keys()) this.state.collapsedGroups.add(name);
    this.render();
  }

  toggleDetail(id) {
    if (this.state.expandedId === id) this.state.expandedId = null;
    else { this.state.expandedId = id; this.state.cursor = id; }
    this.render();
  }

  toggleGroup(name) {
    if (this.state.collapsedGroups.has(name)) this.state.collapsedGroups.delete(name);
    else this.state.collapsedGroups.add(name);
    this.render();
  }

  toast(msg, undoable) {
    const t = this.toastEl.createDiv('wk-toast');
    t.createSpan({ text: msg });
    if (undoable) {
      const u = t.createSpan({ cls: 'wk-toast-undo', text: 'Undo' });
      u.addEventListener('click', () => { this.undo(); t.remove(); });
    }
    setTimeout(() => {
      t.addClass('wk-toast-out');
      setTimeout(() => t.remove(), 220);
    }, 3500);
  }

  async undo() {
    const op = this.undoStack.pop();
    if (!op) {
      new Notice('Nothing to undo');
      return;
    }
    await this.plugin.store.update(op.todoId, op.prev);
  }

  // ---- Keyboard ----

  handleKey(e) {
    if (this.editingId !== null) return;
    if (this.palette.isOpen) return;
    const target = e.target;
    const inSearch = target?.classList?.contains('wk-search');

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.palette.open();
      return;
    }
    if (!inSearch && e.key === '/') {
      e.preventDefault();
      this.refs.toolbar.querySelector('.wk-search')?.focus();
      return;
    }
    if (inSearch) {
      if (e.key === 'Escape') {
        target.blur();
        this.containerEl.children[1].focus();
      }
      return;
    }

    if (e.shiftKey && (e.key === 'J' || e.key === 'K')) {
      e.preventDefault();
      if (e.key === 'J') this.moveDown();
      else this.moveUp();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      this.openQuickAdd();
      return;
    }

    if (e.key === 'j')        { e.preventDefault(); this.moveCursor(1); }
    else if (e.key === 'k')   { e.preventDefault(); this.moveCursor(-1); }
    else if (e.key === 'x')   { e.preventDefault(); this.toggleSelected(); }
    else if (e.key === 'e')   { e.preventDefault(); this.startEditCursor(); }
    else if (e.key === ' ')   { e.preventDefault(); this.toggleDetailCursor(); }
    else if (e.key === 'z')   { e.preventDefault(); this.undo(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.openRefCursor(); }
    else if (e.key === 'Escape') {
      if (this.state.expandedId) { this.state.expandedId = null; this.render(); }
      else { this.state.selected.clear(); this.render(); }
    }
    else if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      this.setPrioritySelected(parseInt(e.key, 10));
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && this.targets().length > 0) {
      e.preventDefault();
      this.deleteSelected();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const visible = this.getVisible();
      this.state.selected = new Set(visible.map(t => t.id));
      this.render();
    }
  }
}

// ============================================================
// Plugin entry
// ============================================================

// ============================================================
// Reset confirmation modal
// ============================================================

class ResetConfirmModal extends Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  onOpen() {
    this.modalEl.addClass('wk-project-modal');
    this.contentEl.empty();

    const header = this.contentEl.createDiv('wk-qa-header');
    header.createDiv({ cls: 'wk-qa-title', text: 'Reset all data?' });
    header.createDiv({ cls: 'wk-qa-subtitle', text: 'This deletes every task, project, view override, and setting.' });

    const body = this.contentEl.createDiv({ cls: 'wk-qa-input-wrap' });
    const stats = body.createDiv({ cls: 'setting-item-description' });
    stats.style.lineHeight = '1.6';
    const active = this.plugin.data.todos.filter(t => !t.completed).length;
    const done = this.plugin.data.todos.filter(t => t.completed).length;
    const projects = this.plugin.data.projects.length;
    stats.createDiv().setText(`You are about to delete:`);
    stats.createDiv().setText(`   - ${active} active task(s)`);
    stats.createDiv().setText(`   - ${done} completed task(s) in your logbook`);
    stats.createDiv().setText(`   - ${projects} project(s)`);
    stats.createDiv().setText(`This cannot be undone. Consider exporting a backup first.`);

    // Type-to-confirm
    const confirmWrap = this.contentEl.createDiv({ cls: 'wk-qa-input-wrap' });
    confirmWrap.createDiv({ cls: 'wk-qa-section-label', text: 'Type RESET to confirm' });
    const input = confirmWrap.createEl('input', { cls: 'wk-qa-input', type: 'text' });
    input.placeholder = 'RESET';

    const actions = this.contentEl.createDiv('wk-qa-actions');
    const cancelBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Cancel' });
    const exportBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-secondary', text: 'Export backup first' });
    const resetBtn = actions.createEl('button', { cls: 'wk-qa-btn wk-qa-btn-danger', text: 'Reset everything' });
    resetBtn.setAttribute('disabled', 'true');

    input.addEventListener('input', () => {
      if (input.value === 'RESET') resetBtn.removeAttribute('disabled');
      else resetBtn.setAttribute('disabled', 'true');
    });
    input.addEventListener('keydown', e => e.stopPropagation());

    cancelBtn.addEventListener('click', () => this.close());
    exportBtn.addEventListener('click', () => this.plugin.exportData());
    resetBtn.addEventListener('click', async () => {
      this.plugin.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
      await this.plugin.save();
      this.plugin.refreshOpenViews();
      new Notice('All Wake data has been reset.');
      this.close();
      if (this.onDone) this.onDone();
    });

    setTimeout(() => input.focus(), 50);
  }
}

// ============================================================
// Plugin entry
// ============================================================

class WakePlugin extends Plugin {
  async onload() {
    const loaded = (await this.loadData()) || {};
    this.data = Object.assign({}, DEFAULT_DATA, loaded);
    this.migrate();

    this.store = new WakeStore(this);

    this.registerView(VIEW_TYPE_WAKE, leaf => new WakeView(leaf, this));

    this.addRibbonIcon('check-circle', 'Open Wake', () => this.activateView());

    this.addCommand({
      id: 'open-view',
      name: 'Open Wake panel',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'quick-add',
      name: 'Quick add task',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'T' }],
      callback: () => {
        const useCurrent = this.data.newTaskDefault === 'currentView';
        const projectId = (useCurrent && this.data.activeView?.kind === 'project') ? this.data.activeView.ref : null;
        new QuickAddModal(this.app, this, projectId).open();
      },
    });

    this.addCommand({
      id: 'new-project',
      name: 'New project',
      callback: () => new NewProjectModal(this.app, this).open(),
    });

    this.addSettingTab(new WakeSettingsTab(this.app, this));
  }

  migrate() {
    // Collections
    if (!Array.isArray(this.data.todos)) this.data.todos = [];
    if (!Array.isArray(this.data.projects)) this.data.projects = [];
    if (typeof this.data.lastId !== 'number') this.data.lastId = 0;
    if (typeof this.data.lastProjectId !== 'number') this.data.lastProjectId = 0;
    if (!this.data.activeView || !this.data.activeView.kind) this.data.activeView = { kind: 'all' };

    // Settings introduced in v0.6
    if (typeof this.data.viewOverrides !== 'object' || this.data.viewOverrides === null) this.data.viewOverrides = {};
    if (!['comfortable', 'compact'].includes(this.data.density)) this.data.density = 'comfortable';
    if (!['short', 'iso', 'long', 'relative'].includes(this.data.dateFormat)) this.data.dateFormat = 'short';
    if (!['currentView', 'inbox'].includes(this.data.newTaskDefault)) this.data.newTaskDefault = 'currentView';
    if (typeof this.data.showTagsInSidebar !== 'boolean') this.data.showTagsInSidebar = true;

    // Per-todo cleanup
    for (const t of this.data.todos) {
      // v0.5 hack: project = first tag (string). Reset string projects unless they're real project IDs.
      if (typeof t.project === 'string' && !/^pj-\d+$/.test(t.project)) t.project = null;
      if (!Array.isArray(t.tags)) t.tags = [];
      if (!Array.isArray(t.links)) t.links = [];
      if (typeof t.description !== 'string') t.description = '';
    }
  }

  onunload() {}

  async save() {
    await this.saveData(this.data);
  }

  // Re-render every open Wake view. Used when Settings tab changes a setting that
  // affects an existing view's appearance.
  refreshOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WAKE)) {
      const view = leaf.view;
      if (view && typeof view.render === 'function') view.render();
    }
  }

  // Trigger a JSON download with the full plugin data (tasks, projects, settings).
  exportData() {
    const json = JSON.stringify(this.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wake-export-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    new Notice('Wake data exported.');
  }

  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_WAKE);
    let leaf = existing[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE_WAKE, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }
}

module.exports = WakePlugin;
