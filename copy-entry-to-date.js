(() => {
  'use strict';

  if (!window.App || App.__copyEntryToDateInstalled) return;
  App.__copyEntryToDateInstalled = true;

  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(id) {
    const result = originalOpenEntryEditor.call(this, id);
    const modal = document.getElementById('modalContent');
    if (!modal) return result;

    const copyButton = [...modal.querySelectorAll('button')]
      .find(button => button.getAttribute('onclick')?.includes(`copySingleEntry('${id}')`));
    if (!copyButton) return result;

    copyButton.textContent = 'Copy to another date';
    copyButton.setAttribute('onclick', `App.openCopyEntryToDate('${this.attr(id)}')`);
    return result;
  };

  App.openCopyEntryToDate = function(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    if (!entry) return;

    const today = this.today();
    const defaultDate = entry.date === today ? this.shiftDate(entry.date, 1) : today;
    const currentTagId = this.cache.tags.some(tag => tag.id === entry.mealTagId)
      ? entry.mealTagId
      : '';

    this.showModal(`
      <div class="row space">
        <div>
          <div class="eyebrow">Copy logged food</div>
          <h2 style="margin-bottom:.2rem">Copy ${this.esc(entry.name || 'food')}</h2>
          <div class="tiny muted">Currently logged on ${this.esc(this.formatDate(entry.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</div>
        </div>
        <button class="icon-btn" type="button" onclick="App.closeModal()">×</button>
      </div>

      <div class="form-grid" style="margin-top:.9rem">
        <label>Copy to date
          <input id="copyEntryDestinationDate" type="date" value="${this.attr(defaultDate)}" />
        </label>
        <label>Meal tag
          <select id="copyEntryDestinationTag">
            <option value="" ${currentTagId ? '' : 'selected'}>Untagged</option>
            ${this.cache.tags.map(tag => `
              <option value="${this.attr(tag.id)}" ${tag.id === currentTagId ? 'selected' : ''}>${this.esc(tag.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="card subtle" style="margin-top:.9rem">
        <div class="small"><strong>${this.esc(entry.name || 'Unnamed Food')}</strong> · ${this.formatNumber(entry.calories)} cal</div>
        ${entry.portionName ? `<div class="tiny muted" style="margin-top:.25rem">Serving: ${this.esc(entry.portionName)}${Number.isFinite(Number(entry.multiplier)) ? ` · ${this.esc(entry.multiplier)}×` : ''}</div>` : ''}
        ${entry.note ? `<div class="tiny muted" style="margin-top:.25rem">Note will be copied too.</div>` : ''}
      </div>

      <div class="actions" style="margin-top:1rem">
        <button class="btn primary" type="button" onclick="App.confirmCopyEntryToDate('${this.attr(entry.id)}')">Copy entry</button>
        <button class="btn ghost" type="button" onclick="App.openEntryEditor('${this.attr(entry.id)}')">Back</button>
      </div>
    `);
  };

  App.confirmCopyEntryToDate = async function(id) {
    const source = this.cache.entries.find(item => item.id === id);
    if (!source) return;

    const date = document.getElementById('copyEntryDestinationDate')?.value || '';
    const mealTagId = document.getElementById('copyEntryDestinationTag')?.value || '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return this.showToast('Choose a destination date');
    }
    if (date === source.date) {
      return this.showToast('Choose a different date');
    }

    const tag = mealTagId ? this.cache.tags.find(item => item.id === mealTagId) : null;
    if (mealTagId && !tag) {
      return this.showToast('Choose a valid meal tag');
    }

    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: this.uid('entry'),
      date,
      timestamp: now,
      mealTagId: tag?.id || '',
      mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.put('entries', copy);
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast(`${copy.name || 'Entry'} copied to ${this.formatDate(date)}`);
  };
})();
