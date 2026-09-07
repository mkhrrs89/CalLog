(() => {
  'use strict';

  if (!window.App || App.__multiEntryCopyInstalled) return;
  App.__multiEntryCopyInstalled = true;

  const groupNameFor = entry => {
    const tag = App.cache.tags.find(item => item.id === entry.mealTagId);
    return tag?.name || entry.mealTagSnapshot?.name || 'Untagged';
  };

  const defaultDestination = sourceDate => (
    sourceDate === App.today() ? App.shiftDate(sourceDate, 1) : App.today()
  );

  const originalRenderToday = App.renderToday;
  App.renderToday = async function(...args) {
    let html = await originalRenderToday.apply(this, args);
    const entries = this.entriesForDate();
    const button = `<button class="btn ghost small-btn" onclick="App.openMultiEntryCopy()" ${entries.length ? '' : 'disabled'}>Copy selected</button>`;
    html = html.replace(
      '<button class="btn ghost small-btn" onclick="App.openCopyDialog()">Copy previous</button>',
      `<button class="btn ghost small-btn" onclick="App.openCopyDialog()">Copy previous</button>${button}`
    );
    return html;
  };

  App.openMultiEntryCopy = function() {
    const sourceDate = this.view.date;
    const entries = this.entriesForDate(sourceDate);
    if (!entries.length) return this.showToast('No entries to copy on this date');

    const groups = new Map();
    entries.forEach(entry => {
      const name = groupNameFor(entry);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    });

    this.multiCopySourceDate = sourceDate;
    this.multiCopySelection = new Set();

    this.showModal(`
      <div class="row space">
        <div>
          <div class="eyebrow">${this.esc(this.formatDate(sourceDate))}</div>
          <h2>Copy selected entries</h2>
        </div>
        <button class="icon-btn" type="button" onclick="App.closeModal()">×</button>
      </div>

      <p class="small">Choose individual foods from one or more meals, then copy them together to another date.</p>

      <div class="multi-copy-toolbar">
        <button class="btn ghost small-btn" type="button" onclick="App.setMultiCopyAll(true)">Select all</button>
        <button class="btn ghost small-btn" type="button" onclick="App.setMultiCopyAll(false)">Clear</button>
        <strong id="multiCopyCount">0 selected</strong>
      </div>

      <div class="multi-copy-groups">
        ${[...groups.entries()].map(([name, items], groupIndex) => `
          <section class="multi-copy-group" data-copy-group="${groupIndex}">
            <div class="row space multi-copy-group-head">
              <strong>${this.esc(name)}</strong>
              <button class="btn ghost small-btn" type="button" onclick="App.selectMultiCopyGroup(${groupIndex})">Select meal</button>
            </div>
            <div class="multi-copy-items">
              ${items.map(entry => `
                <label class="multi-copy-item">
                  <input type="checkbox" data-copy-entry-id="${this.attr(entry.id)}" onchange="App.toggleMultiCopyEntry('${this.attr(entry.id)}',this.checked)" />
                  <span class="multi-copy-item-main">
                    <strong>${this.esc(entry.name || 'Unnamed Food')}</strong>
                    <span class="tiny muted">${entry.caloriesPending ? 'Calories TBD' : `${this.formatNumber(entry.calories)} cal`}${entry.portionName ? ` · ${this.esc(entry.portionName)}` : ''}</span>
                  </span>
                </label>`).join('')}
            </div>
          </section>`).join('')}
      </div>

      <div class="multi-copy-destination">
        <label>Copy to date
          <input id="multiCopyDestination" type="date" value="${this.attr(defaultDestination(sourceDate))}" />
        </label>
      </div>

      <div class="actions multi-copy-actions">
        <button id="multiCopySubmit" class="btn primary" type="button" onclick="App.copySelectedEntriesToDate()" disabled>Copy selected</button>
        <button class="btn ghost" type="button" onclick="App.closeModal()">Cancel</button>
      </div>
    `);

    this.multiCopyGroups = [...groups.values()].map(items => items.map(entry => entry.id));
  };

  App.updateMultiCopyUi = function() {
    const count = this.multiCopySelection?.size || 0;
    const countEl = document.getElementById('multiCopyCount');
    if (countEl) countEl.textContent = `${count} selected`;
    const submit = document.getElementById('multiCopySubmit');
    if (submit) submit.disabled = count === 0;
  };

  App.toggleMultiCopyEntry = function(entryId, checked) {
    if (!this.multiCopySelection) this.multiCopySelection = new Set();
    if (checked) this.multiCopySelection.add(entryId);
    else this.multiCopySelection.delete(entryId);
    this.updateMultiCopyUi();
  };

  App.setMultiCopyAll = function(selected) {
    const boxes = [...document.querySelectorAll('[data-copy-entry-id]')];
    if (!this.multiCopySelection) this.multiCopySelection = new Set();
    boxes.forEach(box => {
      box.checked = selected;
      if (selected) this.multiCopySelection.add(box.dataset.copyEntryId || '');
      else this.multiCopySelection.delete(box.dataset.copyEntryId || '');
    });
    this.multiCopySelection.delete('');
    this.updateMultiCopyUi();
  };

  App.selectMultiCopyGroup = function(groupIndex) {
    const ids = this.multiCopyGroups?.[groupIndex] || [];
    if (!this.multiCopySelection) this.multiCopySelection = new Set();
    ids.forEach(id => this.multiCopySelection.add(id));
    document.querySelectorAll('[data-copy-entry-id]').forEach(box => {
      if (ids.includes(box.dataset.copyEntryId || '')) box.checked = true;
    });
    this.updateMultiCopyUi();
  };

  App.copySelectedEntriesToDate = async function() {
    const sourceDate = this.multiCopySourceDate || this.view.date;
    const destination = document.getElementById('multiCopyDestination')?.value || '';
    const selectedIds = [...(this.multiCopySelection || [])];

    if (!selectedIds.length) return this.showToast('Select at least one entry');
    if (!destination) return this.showToast('Choose a destination date');
    if (destination === sourceDate) return this.showToast('Choose a different destination date');

    const selected = this.cache.entries
      .filter(entry => selectedIds.includes(entry.id))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (!selected.length) return this.showToast('Those entries are no longer available');

    const baseTime = Date.now();
    const copies = selected.map((entry, index) => {
      const timestamp = new Date(baseTime + index * 1000).toISOString();
      return {
        ...entry,
        id: this.uid('entry'),
        date: destination,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    await this.db.putMany('entries', copies);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.multiCopySelection = null;
    this.multiCopyGroups = null;
    this.multiCopySourceDate = null;
    this.showToast(`${copies.length} entr${copies.length === 1 ? 'y' : 'ies'} copied to ${this.formatDate(destination)}`);
  };
})();
