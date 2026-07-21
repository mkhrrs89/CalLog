'use strict';

const DB_NAME = 'foodlog_db';
const DB_VERSION = 1;
const STORES = ['foods', 'entries', 'mealTags', 'days', 'revisions', 'settings'];

class FoodLogDB {
  constructor() { this.db = null; }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('foods')) {
          const store = db.createObjectStore('foods', { keyPath: 'id' });
          store.createIndex('nameLower', 'nameLower', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
          store.createIndex('pinned', 'pinned', { unique: false });
        }
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('foodId', 'foodId', { unique: false });
        }
        if (!db.objectStoreNames.contains('mealTags')) {
          db.createObjectStore('mealTags', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('days')) {
          db.createObjectStore('days', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('revisions')) {
          const store = db.createObjectStore('revisions', { keyPath: 'id' });
          store.createIndex('entityId', 'entityId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => { this.db = request.result; resolve(this); };
      request.onerror = () => reject(request.error);
    });
  }

  store(name, mode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  get(name, key) {
    return new Promise((resolve, reject) => {
      const request = this.store(name).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  getAll(name) {
    return new Promise((resolve, reject) => {
      const request = this.store(name).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  getAllByIndex(name, indexName, key) {
    return new Promise((resolve, reject) => {
      const request = this.store(name).index(indexName).getAll(key);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  put(name, value) {
    return new Promise((resolve, reject) => {
      const request = this.store(name, 'readwrite').put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  delete(name, key) {
    return new Promise((resolve, reject) => {
      const request = this.store(name, 'readwrite').delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  clear(name) {
    return new Promise((resolve, reject) => {
      const request = this.store(name, 'readwrite').clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async putMany(name, values) {
    if (!values.length) return;
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      values.forEach(value => store.put(value));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async replaceAll(payload) {
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORES, 'readwrite');
      for (const name of STORES) {
        const store = tx.objectStore(name);
        store.clear();
        const values = name === 'mealTags' ? payload.mealTags : (payload[name] || []);
        values.forEach(value => store.put(value));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

const App = {
  db: new FoodLogDB(),
  view: {
    page: 'today',
    date: null,
    entryView: 'chronological',
    foodQuery: '',
    foodBulk: false,
    selectedFoods: new Set(),
    statsRange: 30,
    bumpTotal: false,
  },
  cache: { foods: [], entries: [], tags: [], days: [], settings: {} },
  modalHandlers: new Map(),
  toastTimer: null,
  renderToken: 0,

  async init() {
    this.view.date = this.today();
    try {
      await this.db.open();
      await this.ensureSettings();
      await this.refreshCache();
      this.view.entryView = this.cache.settings.entryView || 'chronological';
      await this.render();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    } catch (error) {
      console.error(error);
      document.getElementById('app').innerHTML = `
        <section class="card danger-zone">
          <h2>FoodLog could not open its local database.</h2>
          <p>${this.esc(error?.message || error)}</p>
          <button class="btn" onclick="location.reload()">Reload</button>
        </section>`;
    }
  },

  uid(prefix = 'id') {
    if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  },

  today() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  },

  localDate(dateString) {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  dateKey(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  },

  shiftDate(dateString, amount) {
    const d = this.localDate(dateString);
    d.setDate(d.getDate() + amount);
    return this.dateKey(d);
  },

  formatDate(dateString, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
    return new Intl.DateTimeFormat(undefined, options).format(this.localDate(dateString));
  },

  formatNumber(value) {
    return new Intl.NumberFormat().format(Math.round(Number(value) || 0));
  },

  esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  },

  attr(value) { return this.esc(value).replace(/`/g, '&#96;'); },

  normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(servings?|pieces?|pcs?|the|a|an)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/s$/, '');
  },

  async ensureSettings() {
    const defaults = {
      entryView: 'chronological',
      tapTotalAction: 'summary',
      importMode: 'merge',
      version: 1,
    };
    for (const [key, value] of Object.entries(defaults)) {
      const existing = await this.db.get('settings', key);
      if (!existing) await this.db.put('settings', { key, value });
    }
  },

  async refreshCache() {
    const [foods, entries, tags, days, settingsRows] = await Promise.all([
      this.db.getAll('foods'),
      this.db.getAll('entries'),
      this.db.getAll('mealTags'),
      this.db.getAll('days'),
      this.db.getAll('settings'),
    ]);
    this.cache.foods = foods;
    this.cache.entries = entries;
    this.cache.tags = tags.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    this.cache.days = days;
    this.cache.settings = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
  },

  async setSetting(key, value) {
    await this.db.put('settings', { key, value });
    this.cache.settings[key] = value;
  },

  navHtml(kind) {
    const items = [
      ['today', '⌂', 'Today'],
      ['foods', '◉', 'Foods'],
      ['stats', '▥', 'Stats'],
      ['settings', '⚙', 'Settings'],
    ];
    return items.map(([page, icon, label]) => `
      <button class="${this.view.page === page ? 'active' : ''}" onclick="App.go('${page}')">
        ${kind === 'bottom' ? `<span class="nav-icon">${icon}</span>` : ''}
        <span>${label}</span>
      </button>`).join('');
  },

  async go(page) {
    this.view.page = page;
    if (page === 'today') this.view.date = this.today();
    this.closeSheet();
    this.closeModal();
    await this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async render() {
    const token = ++this.renderToken;
    document.getElementById('desktopNav').innerHTML = this.navHtml('desktop');
    document.getElementById('bottomNav').innerHTML = this.navHtml('bottom');
    const fab = document.getElementById('fab');
    fab.classList.toggle('hidden', this.view.page !== 'today');
    const app = document.getElementById('app');
    app.innerHTML = '<div class="muted small">Loading…</div>';
    let html = '';
    if (this.view.page === 'today') html = await this.renderToday();
    if (this.view.page === 'foods') html = await this.renderFoods();
    if (this.view.page === 'stats') html = await this.renderStats();
    if (this.view.page === 'settings') html = await this.renderSettings();
    if (token !== this.renderToken) return;
    app.innerHTML = html;
    if (this.view.bumpTotal) {
      requestAnimationFrame(() => document.querySelector('.total-number')?.classList.add('bump'));
      this.view.bumpTotal = false;
    }
  },

  tagMap() {
    return new Map(this.cache.tags.map(tag => [tag.id, tag]));
  },

  dayRecord(date = this.view.date) {
    return this.cache.days.find(day => day.date === date) || { date, complete: false };
  },

  entriesForDate(date = this.view.date) {
    return this.cache.entries
      .filter(entry => entry.date === date)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  totalForDate(date = this.view.date) {
    return this.entriesForDate(date).reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
  },

  async renderToday() {
    const entries = this.entriesForDate();
    const total = entries.reduce((sum, item) => sum + item.calories, 0);
    const day = this.dayRecord();
    const pinned = this.cache.foods.filter(food => food.pinned).sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 8);
    const scaleMax = Math.max(500, Math.ceil(Math.max(total, 1) / 500) * 500);
    const percent = Math.min(100, total / scaleMax * 100);
    const today = this.today();
    const title = this.view.date === today ? 'Today' : this.formatDate(this.view.date, { weekday: 'long', month: 'long', day: 'numeric' });
    const tapAction = this.cache.settings.tapTotalAction || 'summary';

    return `
      <div class="page">
        <div class="page-head">
          <div>
            <div class="eyebrow">Daily log</div>
            <h1>${this.esc(title)}</h1>
          </div>
          <div class="date-nav">
            <button class="icon-btn" onclick="App.changeDate(-1)" aria-label="Previous day">‹</button>
            <button class="date-button" onclick="App.openCalendarPicker()">${this.esc(this.formatDate(this.view.date))}</button>
            <button class="icon-btn" onclick="App.changeDate(1)" aria-label="Next day">›</button>
          </div>
        </div>

        <section class="card total-card" ${tapAction !== 'none' ? 'role="button" tabindex="0" onclick="App.handleTotalTap()"' : ''}>
          <div class="row space" style="position:relative;z-index:1">
            <div>
              <div class="eyebrow">Total calories</div>
              <div class="total-number">${this.formatNumber(total)}</div>
            </div>
            ${day.complete
              ? '<span class="complete-badge">✓ Complete</span>'
              : '<button class="btn small-btn" onclick="event.stopPropagation();App.toggleDayComplete(true)">Mark complete</button>'}
          </div>
          <div class="accumulation" style="position:relative;z-index:1">
            <div class="row space tiny muted"><span>Accumulated</span><span>Auto-scale ${this.formatNumber(scaleMax)}</span></div>
            <div class="accumulation-track"><div class="accumulation-fill" style="width:${percent}%"></div></div>
          </div>
        </section>

        <section class="section">
          <div class="section-title">
            <h2>Quick Log</h2>
            <button class="btn ghost small-btn" onclick="App.go('foods')">Manage foods</button>
          </div>
          ${pinned.length ? `
            <div class="quick-grid">
              ${pinned.map(food => this.quickFoodHtml(food)).join('')}
            </div>` : `
            <div class="empty-state">Pin foods in your database and they’ll appear here for one-tap logging.</div>`}
        </section>

        <section class="section">
          <div class="section-title">
            <h2>${this.view.date === today ? "Today's entries" : 'Entries'}</h2>
            <div class="actions">
              <button class="btn ghost small-btn" onclick="App.openCopyDialog()">Copy previous</button>
              <div class="segmented" aria-label="Entry view">
                <button class="${this.view.entryView === 'chronological' ? 'active' : ''}" onclick="App.setEntryView('chronological')">Chronological</button>
                <button class="${this.view.entryView === 'grouped' ? 'active' : ''}" onclick="App.setEntryView('grouped')">Grouped</button>
              </div>
            </div>
          </div>
          ${this.entriesHtml(entries)}
        </section>

        <section class="section">
          ${day.complete
            ? '<button class="btn block ghost" onclick="App.toggleDayComplete(false)">Mark day incomplete</button>'
            : '<button class="btn block primary" onclick="App.toggleDayComplete(true)">Mark day complete</button>'}
        </section>
      </div>`;
  },

  quickFoodHtml(food) {
    return `
      <div class="quick-food">
        <button class="quick-food-main" onclick="App.logFoodQuick('${food.id}')">
          <strong>${this.esc(food.name)}</strong>
          <span class="tiny muted">${this.formatNumber(food.calories)} cal</span>
        </button>
        <button class="quick-food-more" onclick="App.openSavedFoodLogger('${food.id}')" aria-label="Portions and multiplier">⋯</button>
      </div>`;
  },

  entriesHtml(entries) {
    if (!entries.length) return '<div class="empty-state"><strong>0 calories</strong><br>No entries yet.</div>';
    const tags = this.tagMap();
    if (this.view.entryView === 'chronological') {
      return `<div class="entry-list">${entries.map(entry => this.entryRowHtml(entry, tags)).join('')}</div>`;
    }
    const groups = new Map();
    for (const entry of entries) {
      const currentTag = tags.get(entry.mealTagId);
      const name = currentTag?.name || entry.mealTagSnapshot?.name || 'Untagged';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    }
    return [...groups.entries()].map(([name, items]) => `
      <div class="group-head">${this.esc(name)}</div>
      <div class="entry-list">${items.map(entry => this.entryRowHtml(entry, tags)).join('')}</div>`).join('');
  },

  entryRowHtml(entry, tags = this.tagMap()) {
    const currentTag = tags.get(entry.mealTagId);
    const color = currentTag?.color || entry.mealTagSnapshot?.color || 'transparent';
    return `
      <button class="entry-row" style="border-left-color:${this.attr(color)}" onclick="App.openEntryEditor('${entry.id}')">
        <span class="food-name">${this.esc(entry.name || 'Unnamed Food')}</span>
        <span class="calories">${this.formatNumber(entry.calories)} cal</span>
      </button>`;
  },

  async changeDate(amount) {
    this.view.date = this.shiftDate(this.view.date, amount);
    await this.render();
  },

  openCalendarPicker() {
    const picker = document.getElementById('calendarPicker');
    picker.value = this.view.date;
    if (picker.showPicker) picker.showPicker(); else picker.click();
  },

  async pickDate(value) {
    if (!value) return;
    this.view.date = value;
    await this.render();
  },

  async setEntryView(view) {
    this.view.entryView = view;
    await this.setSetting('entryView', view);
    await this.render();
  },

  async toggleDayComplete(complete) {
    const existing = this.dayRecord();
    const record = { ...existing, date: this.view.date, complete, updatedAt: new Date().toISOString() };
    await this.db.put('days', record);
    await this.refreshCache();
    await this.render();
    this.showToast(complete ? 'Day marked complete' : 'Day marked incomplete');
  },

  handleTotalTap() {
    const action = this.cache.settings.tapTotalAction || 'summary';
    if (action === 'none') return;
    if (action === 'meal') return this.openMealBreakdown();
    this.openDaySummary();
  },

  openDaySummary() {
    const entries = this.entriesForDate();
    const total = entries.reduce((sum, entry) => sum + entry.calories, 0);
    const tagCounts = new Map();
    const confidence = { high: 0, medium: 0, low: 0, none: 0 };
    const tags = this.tagMap();
    entries.forEach(entry => {
      const name = tags.get(entry.mealTagId)?.name || entry.mealTagSnapshot?.name || 'Untagged';
      tagCounts.set(name, (tagCounts.get(name) || 0) + entry.calories);
      confidence[entry.confidence || 'none'] += entry.calories;
    });
    this.showModal(`
      <div class="row space"><h2>Day summary</h2><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <div class="stat-grid">
        <div class="stat-card"><div class="tiny muted">Calories</div><div class="stat-value">${this.formatNumber(total)}</div></div>
        <div class="stat-card"><div class="tiny muted">Entries</div><div class="stat-value">${entries.length}</div></div>
      </div>
      <hr class="divider">
      <h3>Meal tags</h3>
      <div class="stack">${[...tagCounts.entries()].map(([name, calories]) => `<div class="row space"><span>${this.esc(name)}</span><strong>${this.formatNumber(calories)}</strong></div>`).join('') || '<div class="muted">No tagged entries.</div>'}</div>
      <hr class="divider">
      <div class="row space"><span>Status</span><strong>${this.dayRecord().complete ? 'Complete' : 'Incomplete'}</strong></div>
    `);
  },

  openMealBreakdown() {
    const entries = this.entriesForDate();
    const tags = this.tagMap();
    const totals = new Map();
    entries.forEach(entry => {
      const name = tags.get(entry.mealTagId)?.name || entry.mealTagSnapshot?.name || 'Untagged';
      totals.set(name, (totals.get(name) || 0) + entry.calories);
    });
    this.showModal(`
      <div class="row space"><h2>Meal breakdown</h2><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <div class="stack">${[...totals.entries()].map(([name, calories]) => `<div class="row space"><span>${this.esc(name)}</span><strong>${this.formatNumber(calories)} cal</strong></div>`).join('') || '<div class="empty-state">No entries yet.</div>'}</div>
    `);
  },

  async openAddSheet() {
    const pinned = this.cache.foods.filter(food => food.pinned).sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 5);
    const recent = [...this.cache.foods].filter(food => food.lastUsedAt).sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt)).slice(0, 5);
    const tags = this.cache.tags;
    this.openSheet(`
      <div class="sheet-head">
        <div><div class="eyebrow">${this.esc(this.formatDate(this.view.date))}</div><h2 style="margin:0">Add food</h2></div>
        <button class="icon-btn" onclick="App.closeSheet()">×</button>
      </div>

      <label>
        Search saved foods and history
        <input id="addSearch" autocomplete="off" placeholder="Search foods, tags, sources, notes…" oninput="App.updateAddSearch(this.value)" />
      </label>
      <div id="addSearchResults" class="search-results" style="margin-top:.55rem">
        ${this.addDefaultSuggestionsHtml(pinned, recent)}
      </div>

      <hr class="divider">
      <h3>New entry</h3>
      <form id="manualEntryForm" class="form-grid" onsubmit="event.preventDefault();App.submitManualEntry()">
        <div class="form-grid two">
          <label>Food name <span class="field-help">Optional</span>
            <input id="manualName" autocomplete="off" placeholder="e.g. Granola bar" oninput="App.syncManualSuggestions(this.value)" />
          </label>
          <label>Calories
            <input id="manualCalories" inputmode="numeric" type="number" min="0" step="1" placeholder="190" required />
          </label>
        </div>
        <label class="checkbox-line">
          <input id="manualSave" type="checkbox" /> Save to Food Database
        </label>
        <details>
          <summary class="muted small" style="cursor:pointer;font-weight:750">More options</summary>
          <div class="form-grid" style="margin-top:.75rem">
            <label>Meal tag <span class="field-help">Optional</span>
              <select id="manualMealTag"><option value="">Untagged</option>${tags.map(tag => `<option value="${tag.id}">${this.esc(tag.name)}</option>`).join('')}</select>
            </label>
            <label>Confidence <span class="field-help">Optional</span>
              <select id="manualConfidence"><option value="">Not specified</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            </label>
            <label>Source <span class="field-help">Optional</span>
              <input id="manualSource" placeholder="Brand, restaurant, or homemade" />
            </label>
            <label>Note <span class="field-help">Only for this log entry</span>
              <textarea id="manualNote" placeholder="Optional context"></textarea>
            </label>
          </div>
        </details>
        <button class="btn primary block" type="submit">Log food</button>
      </form>
    `, false);
    setTimeout(() => document.getElementById('addSearch')?.focus(), 60);
  },

  addDefaultSuggestionsHtml(pinned, recent) {
    if (!pinned.length && !recent.length) return '<div class="muted small">Your saved foods and frequently logged items will appear here.</div>';
    return `
      ${pinned.length ? `<div class="group-head">Pinned</div>${pinned.map(food => this.searchResultFoodHtml(food)).join('')}` : ''}
      ${recent.length ? `<div class="group-head">Recent</div>${recent.map(food => this.searchResultFoodHtml(food)).join('')}` : ''}`;
  },

  searchResultFoodHtml(food) {
    return `
      <button class="search-result" onclick="App.chooseSavedFood('${food.id}')">
        <span><strong>${this.esc(food.name)}</strong><span class="tiny muted" style="display:block">${food.source ? this.esc(food.source) + ' · ' : ''}${this.formatNumber(food.calories)} cal</span></span>
        <span>${food.pinned ? '<span class="star">★</span>' : ''}</span>
      </button>`;
  },

  searchResultHistoryHtml(item) {
    return `
      <button class="search-result" onclick="App.prefillFromHistory('${this.attr(item.name)}',${item.calories})">
        <span><strong>${this.esc(item.name || 'Unnamed Food')}</strong><span class="tiny muted" style="display:block">Frequently logged unsaved · ${item.count}×</span></span>
        <strong>${this.formatNumber(item.calories)}</strong>
      </button>`;
  },

  searchSavedAndHistory(query) {
    const q = this.normalizeName(query);
    if (!q) return { foods: [], history: [] };
    const terms = q.split(' ').filter(Boolean);
    const scoreFood = food => {
      const name = this.normalizeName(food.name);
      const aliases = (food.aliases || []).map(value => this.normalizeName(value));
      const hay = [name, ...aliases, ...(food.tags || []).map(value => this.normalizeName(value)), this.normalizeName(food.source), this.normalizeName(food.folder)].join(' ');
      let score = 0;
      if (name === q) score += 1000;
      if (aliases.includes(q)) score += 920;
      if (name.startsWith(q)) score += 650;
      if (name.includes(q)) score += 420;
      if (terms.every(term => hay.includes(term))) score += 260;
      if (food.pinned) score += 80;
      score += Math.min(70, (food.useCount || 0) * 3);
      if (food.lastUsedAt) score += Math.max(0, 50 - (Date.now() - new Date(food.lastUsedAt)) / 86400000);
      return score;
    };
    const foods = this.cache.foods
      .map(food => ({ food, score: scoreFood(food) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
      .slice(0, 10)
      .map(item => item.food);

    const grouped = new Map();
    this.cache.entries.filter(entry => !entry.foodId && entry.name).forEach(entry => {
      const key = this.normalizeName(entry.name);
      const hay = [entry.name, entry.note, entry.source, entry.mealTagSnapshot?.name].map(value => this.normalizeName(value)).join(' ');
      if (!key || !terms.every(term => hay.includes(term))) return;
      const existing = grouped.get(key) || { name: entry.name, calories: entry.calories, count: 0, latest: entry.timestamp };
      existing.count += 1;
      if (new Date(entry.timestamp) > new Date(existing.latest)) {
        existing.latest = entry.timestamp;
        existing.name = entry.name;
        existing.calories = entry.calories;
      }
      grouped.set(key, existing);
    });
    const history = [...grouped.values()].sort((a, b) => b.count - a.count || new Date(b.latest) - new Date(a.latest)).slice(0, 6);
    return { foods, history };
  },

  updateAddSearch(value) {
    const target = document.getElementById('addSearchResults');
    if (!target) return;
    const query = value.trim();
    if (!query) {
      const pinned = this.cache.foods.filter(food => food.pinned).sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 5);
      const recent = [...this.cache.foods].filter(food => food.lastUsedAt).sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt)).slice(0, 5);
      target.innerHTML = this.addDefaultSuggestionsHtml(pinned, recent);
      return;
    }
    const { foods, history } = this.searchSavedAndHistory(query);
    target.innerHTML = `
      ${foods.length ? `<div class="group-head">Saved foods</div>${foods.map(food => this.searchResultFoodHtml(food)).join('')}` : ''}
      ${history.length ? `<div class="group-head">Frequently logged unsaved</div>${history.map(item => this.searchResultHistoryHtml(item)).join('')}` : ''}
      ${!foods.length && !history.length ? '<div class="muted small">No match. Use the new-entry form below.</div>' : ''}`;
  },

  syncManualSuggestions(value) {
    const search = document.getElementById('addSearch');
    if (search) search.value = value;
    this.updateAddSearch(value);
  },

  prefillFromHistory(name, calories) {
    const nameInput = document.getElementById('manualName');
    const calorieInput = document.getElementById('manualCalories');
    if (nameInput) nameInput.value = name;
    if (calorieInput) calorieInput.value = Math.round(calories);
  },

  chooseSavedFood(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return;
    if ((food.portions || []).length) this.openSavedFoodLogger(id);
    else this.logFoodQuick(id);
  },

  async logFoodQuick(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return;
    if ((food.portions || []).length) return this.openSavedFoodLogger(id);
    await this.logSavedFood(food, { calories: food.calories, multiplier: 1, portionName: 'Default' });
  },

  openSavedFoodLogger(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return;
    const portions = [{ id: 'default', name: 'Default', calories: food.calories }, ...(food.portions || [])];
    this.openSheet(`
      <div class="sheet-head"><div><div class="eyebrow">Saved food</div><h2 style="margin:0">${this.esc(food.name)}</h2></div><button class="icon-btn" onclick="App.closeSheet()">×</button></div>
      <form class="form-grid" onsubmit="event.preventDefault();App.submitSavedFoodLog('${food.id}')">
        <label>Portion
          <select id="savedPortion" onchange="App.updateSavedFoodCalculation('${food.id}')">
            ${portions.map((portion, index) => `<option value="${index}">${this.esc(portion.name)} — ${this.formatNumber(portion.calories)} cal</option>`).join('')}
          </select>
        </label>
        <label>Multiplier
          <div class="actions">
            ${[0.5, 1, 1.5, 2].map(value => `<button type="button" class="chip ${value === 1 ? 'active' : ''}" onclick="App.setMultiplier(${value},this,'${food.id}')">${value}×</button>`).join('')}
          </div>
          <input id="savedMultiplier" type="number" min="0" step="0.1" value="1" oninput="App.updateSavedFoodCalculation('${food.id}')" />
        </label>
        <div class="card subtle"><div class="tiny muted">Calories to log</div><div id="savedCalculatedCalories" class="stat-value">${this.formatNumber(food.calories)}</div></div>
        <label>Meal tag <span class="field-help">Optional</span>
          <select id="savedMealTag"><option value="">Untagged</option>${this.cache.tags.map(tag => `<option value="${tag.id}">${this.esc(tag.name)}</option>`).join('')}</select>
        </label>
        <details>
          <summary class="muted small" style="cursor:pointer;font-weight:750">More options</summary>
          <div class="form-grid" style="margin-top:.75rem">
            <label>Confidence<select id="savedConfidence"><option value="">Not specified</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <label>Note<textarea id="savedNote" placeholder="Optional context for this entry"></textarea></label>
          </div>
        </details>
        <button class="btn primary block" type="submit">Log food</button>
      </form>
    `, true);
  },

  setMultiplier(value, button, foodId) {
    const input = document.getElementById('savedMultiplier');
    if (input) input.value = value;
    button?.parentElement?.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
    button?.classList.add('active');
    this.updateSavedFoodCalculation(foodId);
  },

  updateSavedFoodCalculation(foodId) {
    const food = this.cache.foods.find(item => item.id === foodId);
    if (!food) return;
    const portions = [{ id: 'default', name: 'Default', calories: food.calories }, ...(food.portions || [])];
    const portion = portions[Number(document.getElementById('savedPortion')?.value || 0)] || portions[0];
    const multiplier = Math.max(0, Number(document.getElementById('savedMultiplier')?.value || 1));
    const calories = Math.round(portion.calories * multiplier);
    const target = document.getElementById('savedCalculatedCalories');
    if (target) target.textContent = this.formatNumber(calories);
  },

  async submitSavedFoodLog(foodId) {
    const food = this.cache.foods.find(item => item.id === foodId);
    if (!food) return;
    const portions = [{ id: 'default', name: 'Default', calories: food.calories }, ...(food.portions || [])];
    const portion = portions[Number(document.getElementById('savedPortion')?.value || 0)] || portions[0];
    const multiplier = Math.max(0, Number(document.getElementById('savedMultiplier')?.value || 1));
    await this.logSavedFood(food, {
      calories: Math.round(portion.calories * multiplier),
      multiplier,
      portionName: portion.name,
      mealTagId: document.getElementById('savedMealTag')?.value || '',
      confidence: document.getElementById('savedConfidence')?.value || '',
      note: document.getElementById('savedNote')?.value.trim() || '',
    });
  },

  async logSavedFood(food, options = {}) {
    const tag = this.cache.tags.find(item => item.id === options.mealTagId);
    const now = new Date().toISOString();
    const entry = {
      id: this.uid('entry'),
      date: this.view.date,
      timestamp: now,
      name: food.name,
      calories: Math.max(0, Math.round(options.calories ?? food.calories)),
      foodId: food.id,
      baseCalories: food.calories,
      multiplier: Number(options.multiplier ?? 1),
      portionName: options.portionName || 'Default',
      mealTagId: options.mealTagId || '',
      mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
      confidence: options.confidence || '',
      note: options.note || '',
      source: food.source || '',
      createdAt: now,
      updatedAt: now,
    };
    await this.db.put('entries', entry);
    await this.db.put('foods', { ...food, useCount: (food.useCount || 0) + 1, lastUsedAt: now, updatedAt: now });
    await this.afterLog(entry);
  },

  async submitManualEntry() {
    const name = document.getElementById('manualName')?.value.trim() || '';
    const caloriesRaw = document.getElementById('manualCalories')?.value;
    const calories = Number(caloriesRaw);
    const saveToDatabase = !!document.getElementById('manualSave')?.checked;
    if (!Number.isInteger(calories) || calories < 0) return this.showToast('Enter whole-number calories of 0 or more');
    if (saveToDatabase && !name) return this.showToast('A saved food needs a name');
    const payload = {
      name,
      calories,
      saveToDatabase,
      mealTagId: document.getElementById('manualMealTag')?.value || '',
      confidence: document.getElementById('manualConfidence')?.value || '',
      source: document.getElementById('manualSource')?.value.trim() || '',
      note: document.getElementById('manualNote')?.value.trim() || '',
    };
    if (!saveToDatabase && name) {
      return this.confirmAction({
        title: `Don’t save “${name}”?`,
        message: 'It will still be logged today, but it will not become a reusable saved food.',
        confirmLabel: 'Log without saving',
        onConfirm: () => this.finishManualEntry(payload),
      });
    }
    await this.finishManualEntry(payload);
  },

  findDuplicateFoods(name, ignoreId = null) {
    const normalized = this.normalizeName(name);
    if (!normalized) return [];
    return this.cache.foods.filter(food => {
      if (food.id === ignoreId) return false;
      const other = this.normalizeName(food.name);
      if (other === normalized) return true;
      if (other.includes(normalized) || normalized.includes(other)) return Math.min(other.length, normalized.length) >= 4;
      return this.levenshtein(other, normalized) <= Math.max(1, Math.floor(normalized.length * 0.16));
    });
  },

  levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, () => Array(a.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        matrix[j][i] = b[j - 1] === a[i - 1]
          ? matrix[j - 1][i - 1]
          : Math.min(matrix[j - 1][i - 1] + 1, matrix[j][i - 1] + 1, matrix[j - 1][i] + 1);
      }
    }
    return matrix[b.length][a.length];
  },

  async finishManualEntry(payload, forceNewFood = false) {
    if (payload.saveToDatabase && !forceNewFood) {
      const duplicates = this.findDuplicateFoods(payload.name);
      if (duplicates.length) {
        const first = duplicates[0];
        return this.showModal(`
          <h2>Possible duplicate found</h2>
          <p>A similar saved food already exists:</p>
          <div class="card subtle"><strong>${this.esc(first.name)}</strong><div class="muted small">${this.formatNumber(first.calories)} cal</div></div>
          <div class="actions" style="margin-top:.8rem">
            <button class="btn primary" onclick="App.useExistingForManual('${first.id}')">Use existing food</button>
            <button class="btn ghost" onclick="App.forceFinishManualEntry()">Create new anyway</button>
            <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
          </div>`), this.pendingManualPayload = payload;
      }
    }

    const now = new Date().toISOString();
    let foodId = '';
    if (payload.saveToDatabase) {
      const food = {
        id: this.uid('food'),
        name: payload.name,
        nameLower: this.normalizeName(payload.name),
        calories: payload.calories,
        source: payload.source,
        folder: '',
        tags: [],
        aliases: [],
        portions: [],
        pinned: false,
        useCount: 1,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.put('foods', food);
      foodId = food.id;
    }
    const tag = this.cache.tags.find(item => item.id === payload.mealTagId);
    const entry = {
      id: this.uid('entry'),
      date: this.view.date,
      timestamp: now,
      name: payload.name || 'Unnamed Food',
      calories: payload.calories,
      foodId,
      baseCalories: payload.calories,
      multiplier: 1,
      portionName: 'Manual',
      mealTagId: payload.mealTagId,
      mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
      confidence: payload.confidence,
      note: payload.note,
      source: payload.source,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.put('entries', entry);
    await this.afterLog(entry);
  },

  async useExistingForManual(foodId) {
    const payload = this.pendingManualPayload;
    const food = this.cache.foods.find(item => item.id === foodId);
    this.pendingManualPayload = null;
    this.closeModal();
    if (!payload || !food) return;
    const tag = this.cache.tags.find(item => item.id === payload.mealTagId);
    const now = new Date().toISOString();
    const entry = {
      id: this.uid('entry'), date: this.view.date, timestamp: now,
      name: food.name, calories: payload.calories, foodId: food.id,
      baseCalories: food.calories, multiplier: 1, portionName: 'Manual override',
      mealTagId: payload.mealTagId,
      mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
      confidence: payload.confidence, note: payload.note, source: payload.source || food.source || '',
      createdAt: now, updatedAt: now,
    };
    await this.db.put('entries', entry);
    await this.db.put('foods', { ...food, useCount: (food.useCount || 0) + 1, lastUsedAt: now, updatedAt: now });
    await this.afterLog(entry);
  },

  async forceFinishManualEntry() {
    const payload = this.pendingManualPayload;
    this.pendingManualPayload = null;
    this.closeModal();
    if (payload) await this.finishManualEntry(payload, true);
  },

  async afterLog(entry) {
    this.closeSheet();
    this.closeModal();
    await this.refreshCache();
    this.view.bumpTotal = true;
    await this.render();
    this.showToast(`${entry.name || 'Unnamed Food'} logged — ${this.formatNumber(entry.calories)} cal`);
  },

  openEntryEditor(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    if (!entry) return;
    const tags = this.cache.tags;
    const currentTag = tags.find(tag => tag.id === entry.mealTagId);
    const timestamp = new Date(entry.timestamp);
    this.showModal(`
      <div class="row space"><div><div class="eyebrow">${this.esc(this.formatDate(entry.date))}</div><h2>Edit entry</h2></div><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <form class="form-grid" onsubmit="event.preventDefault();App.saveEntryEdit('${entry.id}')">
        <div class="form-grid two">
          <label>Food name<input id="editEntryName" value="${this.attr(entry.name)}" /></label>
          <label>Calories<input id="editEntryCalories" type="number" min="0" step="1" value="${entry.calories}" required /></label>
        </div>
        <label>Meal tag<select id="editEntryTag"><option value="">Untagged</option>${tags.map(tag => `<option value="${tag.id}" ${tag.id === entry.mealTagId ? 'selected' : ''}>${this.esc(tag.name)}</option>`).join('')}</select></label>
        <label>Confidence<select id="editEntryConfidence"><option value="" ${!entry.confidence ? 'selected' : ''}>Not specified</option><option value="high" ${entry.confidence === 'high' ? 'selected' : ''}>High</option><option value="medium" ${entry.confidence === 'medium' ? 'selected' : ''}>Medium</option><option value="low" ${entry.confidence === 'low' ? 'selected' : ''}>Low</option></select></label>
        <label>Note<textarea id="editEntryNote">${this.esc(entry.note || '')}</textarea></label>
        <div class="card subtle small">
          <div><strong>Logged:</strong> ${this.esc(timestamp.toLocaleString())}</div>
          <div><strong>Portion:</strong> ${this.esc(entry.portionName || '—')} · ${entry.multiplier ?? 1}×</div>
          ${entry.source ? `<div><strong>Source:</strong> ${this.esc(entry.source)}</div>` : ''}
          ${currentTag ? `<div><strong>Tag:</strong> <span class="tag-badge" style="background:${this.attr(currentTag.color)}">${this.esc(currentTag.name)}</span></div>` : ''}
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Save changes</button>
          <button class="btn ghost" type="button" onclick="App.copySingleEntry('${entry.id}')">Copy to ${this.view.date === this.today() ? 'today' : 'this date'}</button>
          <button class="btn danger" type="button" onclick="App.deleteEntryImmediate('${entry.id}')">Delete entry</button>
        </div>
      </form>`);
  },

  async saveEntryEdit(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    if (!entry) return;
    const calories = Number(document.getElementById('editEntryCalories')?.value);
    if (!Number.isInteger(calories) || calories < 0) return this.showToast('Enter whole-number calories of 0 or more');
    const mealTagId = document.getElementById('editEntryTag')?.value || '';
    const tag = this.cache.tags.find(item => item.id === mealTagId);
    const updated = {
      ...entry,
      name: document.getElementById('editEntryName')?.value.trim() || 'Unnamed Food',
      calories,
      mealTagId,
      mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
      confidence: document.getElementById('editEntryConfidence')?.value || '',
      note: document.getElementById('editEntryNote')?.value.trim() || '',
      updatedAt: new Date().toISOString(),
    };
    await this.db.put('entries', updated);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast('Entry updated');
  },

  async deleteEntryImmediate(id) {
    await this.db.delete('entries', id);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast('Entry deleted');
  },

  async copySingleEntry(id) {
    const source = this.cache.entries.find(item => item.id === id);
    if (!source) return;
    const now = new Date().toISOString();
    const copy = { ...source, id: this.uid('entry'), date: this.view.date, timestamp: now, createdAt: now, updatedAt: now };
    await this.db.put('entries', copy);
    this.closeModal();
    await this.refreshCache();
    this.view.bumpTotal = true;
    await this.render();
    this.showToast(`${copy.name} copied`);
  },

  openCopyDialog() {
    const defaultDate = this.shiftDate(this.view.date, -1);
    this.showModal(`
      <div class="row space"><h2>Copy previous entries</h2><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <label>Source date<input id="copySourceDate" type="date" value="${defaultDate}" onchange="App.loadCopySource(this.value)" /></label>
      <div id="copySourceContent" style="margin-top:.8rem"></div>`);
    this.loadCopySource(defaultDate);
  },

  loadCopySource(date) {
    const target = document.getElementById('copySourceContent');
    if (!target) return;
    const entries = this.entriesForDate(date);
    if (!entries.length) {
      target.innerHTML = '<div class="empty-state">No entries on that date.</div>';
      return;
    }
    const tags = this.tagMap();
    const groups = new Map();
    entries.forEach(entry => {
      const name = tags.get(entry.mealTagId)?.name || entry.mealTagSnapshot?.name || 'Untagged';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    });
    target.innerHTML = `
      <div class="actions"><button class="btn primary" onclick="App.copySourceGroup('${date}','__all__')">Copy entire day</button></div>
      <div class="stack" style="margin-top:.75rem">
        ${[...groups.entries()].map(([name, items]) => `
          <div class="card subtle">
            <div class="row space"><strong>${this.esc(name)}</strong><button class="btn small-btn" onclick="App.copySourceGroup('${date}','${this.attr(name)}')">Copy group</button></div>
            <div class="tiny muted">${items.length} item${items.length === 1 ? '' : 's'} · ${this.formatNumber(items.reduce((sum, item) => sum + item.calories, 0))} cal</div>
          </div>`).join('')}
      </div>`;
  },

  async copySourceGroup(date, groupName) {
    const tags = this.tagMap();
    let entries = this.entriesForDate(date);
    if (groupName !== '__all__') {
      entries = entries.filter(entry => (tags.get(entry.mealTagId)?.name || entry.mealTagSnapshot?.name || 'Untagged') === groupName);
    }
    const baseTime = Date.now();
    const copies = entries.map((entry, index) => ({
      ...entry,
      id: this.uid('entry'),
      date: this.view.date,
      timestamp: new Date(baseTime + index * 1000).toISOString(),
      createdAt: new Date(baseTime + index * 1000).toISOString(),
      updatedAt: new Date(baseTime + index * 1000).toISOString(),
    }));
    await this.db.putMany('entries', copies);
    this.closeModal();
    await this.refreshCache();
    this.view.bumpTotal = true;
    await this.render();
    this.showToast(`${copies.length} entr${copies.length === 1 ? 'y' : 'ies'} copied`);
  },

  async renderFoods() {
    const foods = this.cache.foods;
    return `
      <div class="page">
        <div class="page-head">
          <div><div class="eyebrow">Personal library</div><h1>Foods</h1><p>${foods.length} saved food${foods.length === 1 ? '' : 's'}</p></div>
          <div class="actions">
            <button class="btn ghost" onclick="App.toggleFoodBulk()">${this.view.foodBulk ? 'Done' : 'Select'}</button>
            <button class="btn primary" onclick="App.openFoodEditor()">Add food</button>
          </div>
        </div>

        <label>Search database
          <input id="foodSearch" value="${this.attr(this.view.foodQuery)}" placeholder="Names, aliases, tags, source, folder…" oninput="App.updateFoodsSearch(this.value)" />
        </label>

        ${this.view.foodBulk ? this.bulkBarHtml() : ''}
        <div id="foodsResults" style="margin-top:.8rem">${this.foodResultsHtml(this.view.foodQuery)}</div>
      </div>`;
  },

  updateFoodsSearch(value) {
    this.view.foodQuery = value;
    const target = document.getElementById('foodsResults');
    if (target) target.innerHTML = this.foodResultsHtml(value);
  },

  foodResultsHtml(query = '') {
    const q = this.normalizeName(query);
    if (q) {
      const { foods } = this.searchSavedAndHistory(query);
      return foods.length
        ? `<div class="food-list">${foods.map(food => this.foodRowHtml(food)).join('')}</div>`
        : '<div class="empty-state">No saved foods match that search.</div>';
    }
    const pinned = this.cache.foods.filter(food => food.pinned).sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
    const recent = [...this.cache.foods].filter(food => food.lastUsedAt).sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt)).slice(0, 10);
    const all = [...this.cache.foods].sort((a, b) => a.name.localeCompare(b.name));
    if (!all.length) return '<div class="empty-state">Your saved food database is empty.</div>';
    return `
      ${pinned.length ? `<section class="section"><div class="section-title"><h2>Pinned</h2></div><div class="food-list">${pinned.map(food => this.foodRowHtml(food)).join('')}</div></section>` : ''}
      ${recent.length ? `<section class="section"><div class="section-title"><h2>Recent</h2></div><div class="food-list">${recent.map(food => this.foodRowHtml(food)).join('')}</div></section>` : ''}
      <section class="section"><div class="section-title"><h2>All Foods</h2></div><div class="food-list">${all.map(food => this.foodRowHtml(food)).join('')}</div></section>`;
  },

  foodRowHtml(food) {
    const selected = this.view.selectedFoods.has(food.id);
    const meta = [food.source, food.folder, ...(food.tags || []).slice(0, 2)].filter(Boolean).join(' · ');
    return `
      <div class="food-row">
        ${this.view.foodBulk ? `<input type="checkbox" ${selected ? 'checked' : ''} onchange="App.toggleFoodSelected('${food.id}',this.checked)" aria-label="Select ${this.attr(food.name)}" />` : `<span class="star">${food.pinned ? '★' : ''}</span>`}
        <button class="food-row-main" onclick="${this.view.foodBulk ? `App.toggleFoodSelected('${food.id}')` : `App.openFoodEditor('${food.id}')`}">
          <strong class="food-name">${this.esc(food.name)}</strong>
          <div class="food-row-meta">${meta ? this.esc(meta) : `${food.useCount || 0} uses`}</div>
        </button>
        <strong>${this.formatNumber(food.calories)} cal</strong>
      </div>`;
  },

  toggleFoodBulk() {
    this.view.foodBulk = !this.view.foodBulk;
    if (!this.view.foodBulk) this.view.selectedFoods.clear();
    this.render();
  },

  toggleFoodSelected(id, checked) {
    const shouldSelect = checked ?? !this.view.selectedFoods.has(id);
    if (shouldSelect) this.view.selectedFoods.add(id); else this.view.selectedFoods.delete(id);
    const target = document.querySelector('.bulk-bar .selected-count');
    if (target) target.textContent = `${this.view.selectedFoods.size} selected`;
  },

  bulkBarHtml() {
    return `
      <div class="bulk-bar" style="margin-top:.75rem">
        <strong class="selected-count">${this.view.selectedFoods.size} selected</strong>
        <button class="btn small-btn" onclick="App.bulkPin(true)">Pin</button>
        <button class="btn small-btn" onclick="App.bulkPin(false)">Unpin</button>
        <button class="btn small-btn" onclick="App.openBulkMetadata()">Tag / folder / source</button>
        <button class="btn danger small-btn" onclick="App.bulkDelete()">Delete</button>
      </div>`;
  },

  async bulkPin(pinned) {
    if (!this.view.selectedFoods.size) return this.showToast('Select at least one food');
    const now = new Date().toISOString();
    const updates = this.cache.foods.filter(food => this.view.selectedFoods.has(food.id)).map(food => ({ ...food, pinned, updatedAt: now }));
    await this.db.putMany('foods', updates);
    await this.refreshCache();
    await this.render();
    this.showToast(`${updates.length} food${updates.length === 1 ? '' : 's'} ${pinned ? 'pinned' : 'unpinned'}`);
  },

  openBulkMetadata() {
    if (!this.view.selectedFoods.size) return this.showToast('Select at least one food');
    this.showModal(`
      <div class="row space"><h2>Bulk update</h2><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <form class="form-grid" onsubmit="event.preventDefault();App.applyBulkMetadata()">
        <label>Add tags <span class="field-help">Comma-separated; existing tags remain</span><input id="bulkTags" placeholder="restaurant, snack" /></label>
        <label>Set folder <span class="field-help">Leave blank to keep existing folders</span><input id="bulkFolder" placeholder="Meal Prep" /></label>
        <label>Set source <span class="field-help">Leave blank to keep existing sources</span><input id="bulkSource" placeholder="Costco" /></label>
        <button class="btn primary" type="submit">Apply to ${this.view.selectedFoods.size} foods</button>
      </form>`);
  },

  async applyBulkMetadata() {
    const tags = (document.getElementById('bulkTags')?.value || '').split(',').map(value => value.trim()).filter(Boolean);
    const folder = document.getElementById('bulkFolder')?.value.trim() || '';
    const source = document.getElementById('bulkSource')?.value.trim() || '';
    const now = new Date().toISOString();
    const updates = this.cache.foods.filter(food => this.view.selectedFoods.has(food.id)).map(food => ({
      ...food,
      tags: [...new Set([...(food.tags || []), ...tags])],
      folder: folder || food.folder || '',
      source: source || food.source || '',
      updatedAt: now,
    }));
    await this.db.putMany('foods', updates);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast(`${updates.length} foods updated`);
  },

  bulkDelete() {
    if (!this.view.selectedFoods.size) return this.showToast('Select at least one food');
    this.confirmAction({
      title: `Delete ${this.view.selectedFoods.size} saved foods?`,
      message: 'Past daily log entries will remain intact. The saved food templates cannot be recovered unless you restore a backup.',
      confirmLabel: 'Delete saved foods',
      danger: true,
      onConfirm: async () => {
        for (const id of this.view.selectedFoods) await this.db.delete('foods', id);
        const count = this.view.selectedFoods.size;
        this.view.selectedFoods.clear();
        await this.refreshCache();
        await this.render();
        this.showToast(`${count} saved foods deleted`);
      },
    });
  },

  async openFoodEditor(id = '') {
    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    const revisionCount = food ? (await this.db.getAllByIndex('revisions', 'entityId', food.id)).length : 0;
    const recentUses = food ? this.cache.entries.filter(entry => entry.foodId === food.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5) : [];
    this.showModal(`
      <div class="row space"><div><div class="eyebrow">${food ? 'Saved food' : 'New saved food'}</div><h2>${food ? 'Edit food' : 'Add food'}</h2></div><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <form class="form-grid" onsubmit="event.preventDefault();App.saveFoodForm('${food?.id || ''}')">
        <div class="form-grid two">
          <label>Name<input id="foodEditName" value="${this.attr(food?.name || '')}" required /></label>
          <label>Default calories<input id="foodEditCalories" type="number" min="0" step="1" value="${food?.calories ?? ''}" required /></label>
        </div>
        <label class="checkbox-line"><input id="foodEditPinned" type="checkbox" ${food?.pinned ? 'checked' : ''} /> Pin on Today screen</label>
        <div class="form-grid two">
          <label>Source <span class="field-help">Optional</span><input id="foodEditSource" value="${this.attr(food?.source || '')}" placeholder="Brand, restaurant, or homemade" /></label>
          <label>Folder <span class="field-help">Optional</span><input id="foodEditFolder" value="${this.attr(food?.folder || '')}" placeholder="Meal Prep" /></label>
        </div>
        <label>Food tags <span class="field-help">Comma-separated</span><input id="foodEditTags" value="${this.attr((food?.tags || []).join(', '))}" placeholder="snack, frozen, restaurant" /></label>
        <label>Aliases <span class="field-help">Multiple aliases, comma-separated</span><input id="foodEditAliases" value="${this.attr((food?.aliases || []).join(', '))}" placeholder="Oats, O/N Oats" /></label>
        <label>Saved portions <span class="field-help">One per line as Label | Calories</span><textarea id="foodEditPortions" placeholder="1.5 servings | 255\n2 servings | 340">${this.esc((food?.portions || []).map(portion => `${portion.name} | ${portion.calories}`).join('\n'))}</textarea></label>
        <div class="actions">
          <button class="btn primary" type="submit">${food ? 'Save changes' : 'Add food'}</button>
          ${food ? `<button class="btn ghost" type="button" onclick="App.openFoodHistory('${food.id}')">Version history (${revisionCount})</button><button class="btn danger" type="button" onclick="App.deleteSavedFood('${food.id}')">Delete saved food</button>` : ''}
        </div>
        ${food ? `<div class="card subtle"><h3>Recent uses</h3>${recentUses.length ? recentUses.map(entry => `<div class="row space tiny"><span>${this.esc(this.formatDate(entry.date))}</span><strong>${this.formatNumber(entry.calories)} cal</strong></div>`).join('') : '<div class="muted small">No logged uses yet.</div>'}</div>` : ''}
      </form>`);
  },

  parsePortions(text) {
    const portions = [];
    const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      const [namePart, caloriePart] = line.split('|').map(value => value?.trim());
      const calories = Number(caloriePart);
      if (!namePart || !Number.isInteger(calories) || calories < 0) throw new Error(`Invalid portion: “${line}”. Use Label | Calories.`);
      portions.push({ id: this.uid('portion'), name: namePart, calories });
    }
    return portions;
  },

  collectFoodForm(id) {
    const existing = id ? this.cache.foods.find(item => item.id === id) : null;
    const name = document.getElementById('foodEditName')?.value.trim() || '';
    const calories = Number(document.getElementById('foodEditCalories')?.value);
    if (!name) throw new Error('Food name is required');
    if (!Number.isInteger(calories) || calories < 0) throw new Error('Enter whole-number calories of 0 or more');
    const portions = this.parsePortions(document.getElementById('foodEditPortions')?.value || '');
    return {
      id,
      existing,
      name,
      calories,
      pinned: !!document.getElementById('foodEditPinned')?.checked,
      source: document.getElementById('foodEditSource')?.value.trim() || '',
      folder: document.getElementById('foodEditFolder')?.value.trim() || '',
      tags: [...new Set((document.getElementById('foodEditTags')?.value || '').split(',').map(value => value.trim()).filter(Boolean))],
      aliases: [...new Set((document.getElementById('foodEditAliases')?.value || '').split(',').map(value => value.trim()).filter(Boolean))],
      portions,
    };
  },

  async saveFoodForm(id, forceDuplicate = false) {
    let payload;
    try { payload = this.collectFoodForm(id); }
    catch (error) { return this.showToast(error.message); }

    const nameChanged = !payload.existing || this.normalizeName(payload.existing.name) !== this.normalizeName(payload.name);
    if (!forceDuplicate && nameChanged) {
      const duplicates = this.findDuplicateFoods(payload.name, id || null);
      if (duplicates.length) {
        this.pendingFoodForm = payload;
        return this.showModal(`
          <h2>Possible duplicate found</h2>
          <p>“${this.esc(payload.name)}” looks similar to <strong>${this.esc(duplicates[0].name)}</strong>.</p>
          <div class="actions">
            <button class="btn primary" onclick="App.closeModal();App.openFoodEditor('${duplicates[0].id}')">Open existing</button>
            <button class="btn ghost" onclick="App.forceSaveFoodForm()">Save anyway</button>
            <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
          </div>`);
      }
    }
    await this.persistFoodForm(payload);
  },

  async forceSaveFoodForm() {
    const payload = this.pendingFoodForm;
    this.pendingFoodForm = null;
    this.closeModal();
    if (payload) await this.persistFoodForm(payload);
  },

  async persistFoodForm(payload) {
    const { existing } = payload;
    const now = new Date().toISOString();
    if (existing) {
      await this.db.put('revisions', {
        id: this.uid('revision'), entityId: existing.id, entityType: 'food',
        snapshot: structuredClone(existing), createdAt: now,
      });
    }
    const record = {
      ...(existing || {}),
      id: existing?.id || this.uid('food'),
      name: payload.name,
      nameLower: this.normalizeName(payload.name),
      calories: payload.calories,
      pinned: payload.pinned,
      source: payload.source,
      folder: payload.folder,
      tags: payload.tags,
      aliases: payload.aliases,
      portions: payload.portions,
      useCount: existing?.useCount || 0,
      lastUsedAt: existing?.lastUsedAt || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await this.db.put('foods', record);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast(existing ? 'Saved food updated' : 'Saved food added');
  },

  deleteSavedFood(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return;
    this.confirmAction({
      title: `Delete “${food.name}”?`,
      message: 'Past log entries stay unchanged. This saved template will be removed from search and Quick Log.',
      confirmLabel: 'Delete saved food', danger: true,
      onConfirm: async () => {
        await this.db.delete('foods', id);
        this.closeModal();
        await this.refreshCache();
        await this.render();
        this.showToast('Saved food deleted');
      },
    });
  },

  cacheRevisionsFor(entityId) {
    return (this.cache.revisions || []).filter(revision => revision.entityId === entityId);
  },

  async openFoodHistory(id) {
    const revisions = (await this.db.getAllByIndex('revisions', 'entityId', id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const food = this.cache.foods.find(item => item.id === id);
    this.showModal(`
      <div class="row space"><div><div class="eyebrow">Hidden edit history</div><h2>${this.esc(food?.name || 'Food')}</h2></div><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      ${revisions.length ? `<div class="stack">${revisions.map(revision => `
        <div class="card subtle">
          <div class="row space"><div><strong>${this.esc(revision.snapshot.name)}</strong><div class="tiny muted">${this.esc(new Date(revision.createdAt).toLocaleString())}</div></div><strong>${this.formatNumber(revision.snapshot.calories)} cal</strong></div>
          <button class="btn small-btn" style="margin-top:.55rem" onclick="App.restoreFoodRevision('${revision.id}')">Restore this version</button>
        </div>`).join('')}</div>` : '<div class="empty-state">No earlier versions yet.</div>'}`);
  },

  async restoreFoodRevision(revisionId) {
    const revision = await this.db.get('revisions', revisionId);
    if (!revision) return;
    const current = await this.db.get('foods', revision.entityId);
    if (current) await this.db.put('revisions', { id: this.uid('revision'), entityId: current.id, entityType: 'food', snapshot: structuredClone(current), createdAt: new Date().toISOString() });
    await this.db.put('foods', { ...revision.snapshot, updatedAt: new Date().toISOString() });
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast('Earlier food version restored');
  },

  async renderStats() {
    const range = Number(this.view.statsRange || 30);
    const allEntries = [...this.cache.entries];
    const today = this.localDate(this.today());
    let startDate;
    if (range === 0) {
      const earliest = allEntries.map(entry => entry.date).sort()[0] || this.today();
      startDate = this.localDate(earliest);
    } else {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - range + 1);
    }
    const startKey = this.dateKey(startDate);
    const entries = allEntries.filter(entry => entry.date >= startKey && entry.date <= this.today());
    const totalsMap = new Map();
    entries.forEach(entry => totalsMap.set(entry.date, (totalsMap.get(entry.date) || 0) + entry.calories));
    const loggedTotals = [...totalsMap.values()];
    const average = loggedTotals.length ? loggedTotals.reduce((sum, value) => sum + value, 0) / loggedTotals.length : 0;
    const highest = loggedTotals.length ? Math.max(...loggedTotals) : 0;
    const completeDays = this.cache.days.filter(day => day.complete && day.date >= startKey && day.date <= this.today()).length;
    const dateSeries = this.buildDateSeries(startKey, this.today(), totalsMap);
    const mostFoods = this.mostLoggedFoods(entries).slice(0, 8);
    const tagTotals = this.mealTagTotals(entries);
    const confidenceTotals = this.confidenceTotals(entries);
    const sourceTotals = this.sourceTotals(entries).slice(0, 8);
    const growthSeries = this.databaseGrowthSeries(startKey, this.today());

    return `
      <div class="page">
        <div class="page-head">
          <div><div class="eyebrow">Analytics</div><h1>Stats</h1><p>Averages use logged days only.</p></div>
          <div class="segmented">
            ${[[7, '7D'], [30, '30D'], [90, '90D'], [0, 'All']].map(([value, label]) => `<button class="${range === value ? 'active' : ''}" onclick="App.setStatsRange(${value})">${label}</button>`).join('')}
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat-card"><div class="tiny muted">Logged-day average</div><div class="stat-value">${this.formatNumber(average)}</div><div class="tiny muted">calories</div></div>
          <div class="stat-card"><div class="tiny muted">Logged days</div><div class="stat-value">${loggedTotals.length}</div></div>
          <div class="stat-card"><div class="tiny muted">Highest day</div><div class="stat-value">${this.formatNumber(highest)}</div><div class="tiny muted">calories</div></div>
          <div class="stat-card"><div class="tiny muted">Complete days</div><div class="stat-value">${completeDays}</div></div>
        </div>

        <section class="section chart-card">
          <div class="section-title"><h2>Daily calories</h2><span class="tiny muted">Empty days shown as 0</span></div>
          <div class="chart-scroll">${this.lineChart(dateSeries, 'calories')}</div>
        </section>

        <div class="grid two">
          <section class="chart-card">
            <div class="section-title"><h2>Most logged foods</h2></div>
            ${this.horizontalBarChart(mostFoods.map(item => ({ label: item.name, value: item.count })))}
          </section>
          <section class="chart-card">
            <div class="section-title"><h2>Calories by meal tag</h2></div>
            ${this.horizontalBarChart(tagTotals.map(item => ({ label: item.name, value: item.calories, color: item.color })))}
          </section>
        </div>

        <div class="grid two section">
          <section class="chart-card">
            <div class="section-title"><h2>Confidence mix</h2></div>
            ${this.donutChart(confidenceTotals)}
          </section>
          <section class="chart-card">
            <div class="section-title"><h2>Food database growth</h2><span class="tiny muted">${this.cache.foods.length} foods</span></div>
            <div class="chart-scroll">${this.lineChart(growthSeries, 'foods')}</div>
          </section>
        </div>

        <section class="chart-card section">
          <div class="section-title"><h2>Calories by source</h2></div>
          ${this.horizontalBarChart(sourceTotals.map(item => ({ label: item.name, value: item.calories })))}
        </section>
      </div>`;
  },

  async setStatsRange(value) {
    this.view.statsRange = Number(value);
    await this.render();
  },

  buildDateSeries(startKey, endKey, totalsMap) {
    const series = [];
    let cursor = this.localDate(startKey);
    const end = this.localDate(endKey);
    while (cursor <= end) {
      const key = this.dateKey(cursor);
      series.push({ date: key, label: this.formatDate(key, { month: 'short', day: 'numeric' }), value: totalsMap.get(key) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return series;
  },

  mostLoggedFoods(entries) {
    const map = new Map();
    entries.forEach(entry => {
      const key = entry.foodId || this.normalizeName(entry.name);
      const existing = map.get(key) || { name: entry.name || 'Unnamed Food', count: 0, calories: 0 };
      existing.count += 1;
      existing.calories += entry.calories;
      map.set(key, existing);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || b.calories - a.calories);
  },

  mealTagTotals(entries) {
    const tags = this.tagMap();
    const map = new Map();
    entries.forEach(entry => {
      const current = tags.get(entry.mealTagId);
      const name = current?.name || entry.mealTagSnapshot?.name || 'Untagged';
      const color = current?.color || entry.mealTagSnapshot?.color || '#647174';
      const existing = map.get(name) || { name, color, calories: 0 };
      existing.calories += entry.calories;
      map.set(name, existing);
    });
    return [...map.values()].sort((a, b) => b.calories - a.calories);
  },

  sourceTotals(entries) {
    const map = new Map();
    entries.forEach(entry => {
      const name = entry.source?.trim() || 'No source';
      const existing = map.get(name) || { name, calories: 0, count: 0 };
      existing.calories += entry.calories;
      existing.count += 1;
      map.set(name, existing);
    });
    return [...map.values()].sort((a, b) => b.calories - a.calories || b.count - a.count);
  },

  confidenceTotals(entries) {
    const map = { High: 0, Medium: 0, Low: 0, 'Not specified': 0 };
    entries.forEach(entry => {
      const key = entry.confidence === 'high' ? 'High' : entry.confidence === 'medium' ? 'Medium' : entry.confidence === 'low' ? 'Low' : 'Not specified';
      map[key] += entry.calories;
    });
    return Object.entries(map).map(([label, value], index) => ({ label, value, color: ['#0d9488', '#64748b', '#b7791f', '#94a3b8'][index] })).filter(item => item.value > 0);
  },

  databaseGrowthSeries(startKey, endKey) {
    const foods = [...this.cache.foods].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const series = [];
    let cursor = this.localDate(startKey);
    const end = this.localDate(endKey);
    while (cursor <= end) {
      const key = this.dateKey(cursor);
      const value = foods.filter(food => (food.createdAt || '').slice(0, 10) <= key).length;
      series.push({ date: key, label: this.formatDate(key, { month: 'short', day: 'numeric' }), value });
      cursor.setDate(cursor.getDate() + 1);
    }
    return series;
  },

  lineChart(series, unit = '') {
    if (!series.length) return '<div class="empty-state">No data yet.</div>';
    const width = Math.max(360, Math.min(980, series.length * 28));
    const height = 210;
    const pad = { l: 42, r: 12, t: 14, b: 34 };
    const max = Math.max(1, ...series.map(item => item.value));
    const x = index => pad.l + (series.length === 1 ? 0 : index / (series.length - 1) * (width - pad.l - pad.r));
    const y = value => height - pad.b - value / max * (height - pad.t - pad.b);
    const points = series.map((item, index) => `${x(index)},${y(item.value)}`).join(' ');
    const area = `${pad.l},${height - pad.b} ${points} ${x(series.length - 1)},${height - pad.b}`;
    const labelEvery = Math.max(1, Math.ceil(series.length / 6));
    return `
      <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.esc(unit)} chart">
        ${[0, .25, .5, .75, 1].map(tick => {
          const yy = y(max * tick);
          return `<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${width - pad.r}" y2="${yy}"/><text class="chart-label" x="${pad.l - 6}" y="${yy + 3}" text-anchor="end">${this.formatNumber(max * tick)}</text>`;
        }).join('')}
        <polygon class="chart-area" points="${area}"/>
        <polyline class="chart-line" points="${points}"/>
        ${series.map((item, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(item.value)}" r="${series.length > 50 ? 2 : 3}"><title>${this.esc(item.label)}: ${this.formatNumber(item.value)}</title></circle>`).join('')}
        ${series.map((item, index) => index % labelEvery === 0 || index === series.length - 1 ? `<text class="chart-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${this.esc(item.label)}</text>` : '').join('')}
      </svg>`;
  },

  horizontalBarChart(items) {
    if (!items.length) return '<div class="empty-state">No data yet.</div>';
    const max = Math.max(1, ...items.map(item => item.value));
    return `<div class="stack">${items.map(item => `
      <div>
        <div class="row space tiny"><span class="food-name">${this.esc(item.label)}</span><strong>${this.formatNumber(item.value)}</strong></div>
        <div class="accumulation-track" style="height:9px"><div class="accumulation-fill" style="width:${item.value / max * 100}%;${item.color ? `background:${this.attr(item.color)}` : ''}"></div></div>
      </div>`).join('')}</div>`;
  },

  donutChart(items) {
    if (!items.length) return '<div class="empty-state">No confidence data yet.</div>';
    const total = items.reduce((sum, item) => sum + item.value, 0);
    let offset = 0;
    const radius = 62;
    const circumference = 2 * Math.PI * radius;
    const circles = items.map(item => {
      const length = item.value / total * circumference;
      const circle = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${this.attr(item.color)}" stroke-width="24" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"/>`;
      offset += length;
      return circle;
    }).join('');
    return `
      <div class="row wrap" style="justify-content:center">
        <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Confidence breakdown">
          ${circles}
          <text x="90" y="86" text-anchor="middle" class="chart-label">Calories</text>
          <text x="90" y="108" text-anchor="middle" fill="currentColor" font-size="20" font-weight="800">${this.formatNumber(total)}</text>
        </svg>
        <div class="legend">${items.map(item => `<span class="legend-item"><span class="legend-swatch" style="background:${this.attr(item.color)}"></span>${this.esc(item.label)} ${Math.round(item.value / total * 100)}%</span>`).join('')}</div>
      </div>`;
  },

  async renderSettings() {
    const revisions = await this.db.getAll('revisions');
    const dbSize = this.cache.foods.length + this.cache.entries.length + this.cache.tags.length + revisions.length;
    return `
      <div class="page">
        <div class="page-head"><div><div class="eyebrow">Preferences and data</div><h1>Settings</h1><p>FoodLog follows your phone’s light or dark appearance.</p></div></div>

        <div class="grid two">
          <section class="card">
            <h2>Logging preferences</h2>
            <div class="settings-list">
              <label>Tap daily calorie total
                <select onchange="App.updateSettingFromSelect('tapTotalAction',this.value)">
                  <option value="none" ${this.cache.settings.tapTotalAction === 'none' ? 'selected' : ''}>Do nothing</option>
                  <option value="meal" ${this.cache.settings.tapTotalAction === 'meal' ? 'selected' : ''}>Open meal-tag breakdown</option>
                  <option value="summary" ${this.cache.settings.tapTotalAction === 'summary' ? 'selected' : ''}>Open full day summary</option>
                </select>
              </label>
              <label>Default daily-list view
                <select onchange="App.updateEntryViewSetting(this.value)">
                  <option value="chronological" ${this.cache.settings.entryView === 'chronological' ? 'selected' : ''}>Chronological</option>
                  <option value="grouped" ${this.cache.settings.entryView === 'grouped' ? 'selected' : ''}>Grouped by meal tag</option>
                </select>
              </label>
            </div>
          </section>

          <section class="card">
            <h2>Data</h2>
            <p class="small">${this.cache.foods.length} foods · ${this.cache.entries.length} entries · ${dbSize} total records</p>
            <div class="actions">
              <button class="btn primary" onclick="App.exportBackup()">Export full backup</button>
              <button class="btn ghost" onclick="App.exportEntriesCsv()">Entries CSV</button>
              <button class="btn ghost" onclick="App.exportFoodsCsv()">Foods CSV</button>
            </div>
            <hr class="divider">
            <label>Import behavior
              <select id="importMode" onchange="App.updateSettingFromSelect('importMode',this.value)">
                <option value="merge" ${this.cache.settings.importMode !== 'replace' ? 'selected' : ''}>Merge into existing data</option>
                <option value="replace" ${this.cache.settings.importMode === 'replace' ? 'selected' : ''}>Replace all local data</option>
              </select>
            </label>
            <button class="btn ghost" style="margin-top:.65rem" onclick="document.getElementById('importPicker').click()">Import JSON backup</button>
          </section>
        </div>

        <section class="card section">
          <div class="section-title"><div><h2>Custom meal tags</h2><p class="small">Tags are fully custom and can use any color.</p></div><button class="btn primary" onclick="App.openMealTagEditor()">Add tag</button></div>
          ${this.cache.tags.length ? `<div class="stack">${this.cache.tags.map(tag => `
            <div class="tag-manager-row">
              <span class="color-dot" style="background:${this.attr(tag.color)}"></span>
              <strong>${this.esc(tag.name)}</strong>
              <button class="btn small-btn" onclick="App.openMealTagEditor('${tag.id}')">Edit</button>
              <button class="btn danger small-btn" onclick="App.deleteMealTagPrompt('${tag.id}')">Delete</button>
            </div>`).join('')}</div>` : '<div class="empty-state">No meal tags yet. Entries remain untagged until you create one.</div>'}
        </section>

        <section class="card section">
          <h2>Storage</h2>
          <p>All data is stored locally in this browser using IndexedDB. Import/export is the supported way to move or back up FoodLog between devices.</p>
          <p class="small">No account, reminders, barcode scanner, photos, weight tracking, macros, or cloud dependency are included.</p>
        </section>
      </div>`;
  },

  async updateSettingFromSelect(key, value) {
    await this.setSetting(key, value);
    this.showToast('Setting saved');
  },

  async updateEntryViewSetting(value) {
    this.view.entryView = value;
    await this.setSetting('entryView', value);
    this.showToast('Default view saved');
  },

  openMealTagEditor(id = '') {
    const tag = id ? this.cache.tags.find(item => item.id === id) : null;
    this.showModal(`
      <div class="row space"><h2>${tag ? 'Edit meal tag' : 'Add meal tag'}</h2><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <form class="form-grid" onsubmit="event.preventDefault();App.saveMealTag('${tag?.id || ''}')">
        <label>Name<input id="tagName" value="${this.attr(tag?.name || '')}" placeholder="Breakfast" required /></label>
        <label>Color<input id="tagColor" type="color" value="${this.attr(tag?.color || '#0d9488')}" /></label>
        <button class="btn primary" type="submit">Save tag</button>
      </form>`);
  },

  async saveMealTag(id) {
    const existing = id ? this.cache.tags.find(item => item.id === id) : null;
    const name = document.getElementById('tagName')?.value.trim() || '';
    const color = document.getElementById('tagColor')?.value || '#0d9488';
    if (!name) return this.showToast('Tag name is required');
    const duplicate = this.cache.tags.find(tag => tag.id !== id && tag.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return this.showToast('A meal tag with that name already exists');
    const now = new Date().toISOString();
    await this.db.put('mealTags', {
      ...(existing || {}), id: existing?.id || this.uid('tag'), name, color,
      order: existing?.order ?? this.cache.tags.length,
      createdAt: existing?.createdAt || now, updatedAt: now,
    });
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast('Meal tag saved');
  },

  deleteMealTagPrompt(id) {
    const tag = this.cache.tags.find(item => item.id === id);
    if (!tag) return;
    const used = this.cache.entries.filter(entry => entry.mealTagId === id).length;
    this.showModal(`
      <h2>Delete “${this.esc(tag.name)}”?</h2>
      <p>${used ? `This tag is used on ${used} past entr${used === 1 ? 'y' : 'ies'}.` : 'This tag is not used in any entries.'}</p>
      <div class="stack">
        <button class="btn primary" onclick="App.deleteMealTag('${id}','preserve')">Preserve it on past entries</button>
        <button class="btn danger" onclick="App.deleteMealTag('${id}','remove')">Remove it from all history</button>
        <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
      </div>`);
  },

  async deleteMealTag(id, mode) {
    if (mode === 'remove') {
      const updates = this.cache.entries.filter(entry => entry.mealTagId === id).map(entry => ({ ...entry, mealTagId: '', mealTagSnapshot: null, updatedAt: new Date().toISOString() }));
      await this.db.putMany('entries', updates);
    }
    await this.db.delete('mealTags', id);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast(mode === 'preserve' ? 'Tag preserved on past entries' : 'Tag removed from history');
  },

  async exportBackup() {
    const payload = {
      app: 'FoodLog',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      foods: await this.db.getAll('foods'),
      entries: await this.db.getAll('entries'),
      mealTags: await this.db.getAll('mealTags'),
      days: await this.db.getAll('days'),
      revisions: await this.db.getAll('revisions'),
      settings: await this.db.getAll('settings'),
    };
    this.downloadBlob(JSON.stringify(payload, null, 2), `foodlog-backup-${this.today()}.json`, 'application/json');
    this.showToast('Full backup exported');
  },

  exportEntriesCsv() {
    const rows = [['date', 'time', 'food_name', 'calories', 'meal_tag', 'confidence', 'source', 'note', 'saved_food_id']];
    const tags = this.tagMap();
    [...this.cache.entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(entry => {
      rows.push([
        entry.date,
        new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        entry.name,
        entry.calories,
        tags.get(entry.mealTagId)?.name || entry.mealTagSnapshot?.name || '',
        entry.confidence || '',
        entry.source || '',
        entry.note || '',
        entry.foodId || '',
      ]);
    });
    this.downloadBlob(this.csvText(rows), `foodlog-entries-${this.today()}.csv`, 'text/csv;charset=utf-8');
    this.showToast('Entries CSV exported');
  },

  exportFoodsCsv() {
    const rows = [['name', 'default_calories', 'pinned', 'source', 'folder', 'tags', 'aliases', 'portions', 'use_count', 'last_used']];
    [...this.cache.foods].sort((a, b) => a.name.localeCompare(b.name)).forEach(food => {
      rows.push([
        food.name, food.calories, food.pinned ? 'yes' : 'no', food.source || '', food.folder || '',
        (food.tags || []).join('; '), (food.aliases || []).join('; '),
        (food.portions || []).map(portion => `${portion.name}:${portion.calories}`).join('; '),
        food.useCount || 0, food.lastUsedAt || '',
      ]);
    });
    this.downloadBlob(this.csvText(rows), `foodlog-foods-${this.today()}.csv`, 'text/csv;charset=utf-8');
    this.showToast('Foods CSV exported');
  },

  csvText(rows) {
    return rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  },

  downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async handleImportFile(file) {
    document.getElementById('importPicker').value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.app !== 'FoodLog' || payload.schemaVersion !== 1) throw new Error('This is not a supported FoodLog backup.');
      const normalized = {
        foods: Array.isArray(payload.foods) ? payload.foods : [],
        entries: Array.isArray(payload.entries) ? payload.entries : [],
        mealTags: Array.isArray(payload.mealTags) ? payload.mealTags : [],
        days: Array.isArray(payload.days) ? payload.days : [],
        revisions: Array.isArray(payload.revisions) ? payload.revisions : [],
        settings: Array.isArray(payload.settings) ? payload.settings : [],
      };
      const mode = this.cache.settings.importMode || 'merge';
      this.pendingImport = normalized;
      if (mode === 'replace') {
        return this.confirmAction({
          title: 'Replace all local FoodLog data?',
          message: 'This permanently clears the current local database before restoring the backup. Export a current backup first if you may need it.',
          confirmLabel: 'Replace all data', danger: true,
          onConfirm: () => this.applyImport('replace'),
        });
      }
      await this.applyImport('merge');
    } catch (error) {
      console.error(error);
      this.showToast(error.message || 'Could not import that file');
    }
  },

  async applyImport(mode) {
    const payload = this.pendingImport;
    this.pendingImport = null;
    if (!payload) return;
    if (mode === 'replace') {
      await this.db.replaceAll(payload);
    } else {
      await this.db.putMany('foods', payload.foods);
      await this.db.putMany('entries', payload.entries);
      await this.db.putMany('mealTags', payload.mealTags);
      await this.db.putMany('days', payload.days);
      await this.db.putMany('revisions', payload.revisions);
      await this.db.putMany('settings', payload.settings);
    }
    await this.ensureSettings();
    await this.refreshCache();
    this.view.entryView = this.cache.settings.entryView || 'chronological';
    await this.render();
    this.showToast(mode === 'replace' ? 'Backup restored' : 'Backup merged');
  },

  openSheet(html, tall = false) {
    document.getElementById('sheetContent').innerHTML = html;
    document.getElementById('sheet').classList.toggle('tall', !!tall);
    document.getElementById('sheetBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  },

  closeSheet() {
    document.getElementById('sheetBackdrop')?.classList.add('hidden');
    document.getElementById('sheet')?.classList.remove('tall');
    document.body.style.overflow = '';
  },

  backdropClose(event) {
    if (event.target?.id === 'sheetBackdrop') this.closeSheet();
  },

  showModal(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modalBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  },

  closeModal() {
    document.getElementById('modalBackdrop')?.classList.add('hidden');
    document.body.style.overflow = '';
  },

  modalBackdropClose(event) {
    if (event.target?.id === 'modalBackdrop') this.closeModal();
  },

  confirmAction({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    const handlerId = this.uid('handler');
    this.modalHandlers.set(handlerId, onConfirm);
    this.showModal(`
      <h2>${this.esc(title)}</h2>
      <p>${this.esc(message)}</p>
      <div class="actions">
        <button class="btn ${danger ? 'danger' : 'primary'}" onclick="App.runModalHandler('${handlerId}')">${this.esc(confirmLabel)}</button>
        <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
      </div>`);
  },

  async runModalHandler(id) {
    const handler = this.modalHandlers.get(id);
    this.modalHandlers.delete(id);
    this.closeModal();
    if (handler) await handler();
  },

  showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.classList.remove('hidden');
    this.toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
  },
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
