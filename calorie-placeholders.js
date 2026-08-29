(() => {
  'use strict';

  if (!window.App || App.__caloriePlaceholdersInstalled) return;
  App.__caloriePlaceholdersInstalled = true;

  const originalOpenAddSheet = App.openAddSheet;
  App.openAddSheet = async function(...args) {
    const result = await originalOpenAddSheet.apply(this, args);
    const form = document.getElementById('manualEntryForm');
    const submit = form?.querySelector('button[type="submit"]');
    if (!form || !submit || document.getElementById('manualPlaceholderButton')) return result;

    const button = document.createElement('button');
    button.id = 'manualPlaceholderButton';
    button.className = 'btn ghost block calorie-placeholder-button';
    button.type = 'button';
    button.innerHTML = '<span>Log calorie placeholder</span><span class="tiny muted">Add calories later</span>';
    button.addEventListener('click', () => App.submitCaloriePlaceholder());
    submit.insertAdjacentElement('afterend', button);
    return result;
  };

  App.submitCaloriePlaceholder = async function() {
    const name = document.getElementById('manualName')?.value.trim() || '';
    if (!name) return this.showToast('Enter placeholder text in Food name');

    const mealTagId = document.getElementById('manualMealTag')?.value || '';
    const tag = this.cache.tags.find(item => item.id === mealTagId);
    const now = new Date().toISOString();
    const saveWasChecked = !!document.getElementById('manualSave')?.checked;

    const entry = {
      id: this.uid('entry'),
      date: this.view.date,
      timestamp: now,
      name,
      calories: 0,
      caloriesPending: true,
      placeholder: true,
      foodId: '',
      baseCalories: 0,
      multiplier: 1,
      portionName: 'Calories pending',
      mealTagId,
      mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
      confidence: document.getElementById('manualConfidence')?.value || '',
      note: document.getElementById('manualNote')?.value.trim() || '',
      source: document.getElementById('manualSource')?.value.trim() || '',
      createdAt: now,
      updatedAt: now,
    };

    await this.db.put('entries', entry);
    this.closeSheet();
    await this.refreshCache();
    await this.render();
    this.showToast(saveWasChecked
      ? 'Placeholder added to log only — add calories before saving it as a food'
      : 'Calorie placeholder added');
  };

  const originalEntryRowHtml = App.entryRowHtml;
  App.entryRowHtml = function(entry, tags = this.tagMap()) {
    const html = originalEntryRowHtml.call(this, entry, tags);
    if (!entry?.caloriesPending) return html;

    return html
      .replace('class="entry-row"', 'class="entry-row calorie-placeholder-entry"')
      .replace(
        /<span class="calories">[^<]*<\/span>/,
        '<span class="calories calorie-placeholder-calories">Calories TBD</span>'
      );
  };

  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    const result = originalOpenEntryEditor.call(this, id);
    if (!entry?.caloriesPending) return result;

    const caloriesInput = document.getElementById('editEntryCalories');
    if (caloriesInput) {
      caloriesInput.value = '';
      caloriesInput.placeholder = 'Enter calories';
      caloriesInput.focus();
    }

    const form = document.querySelector('#modalContent form');
    if (form && !form.querySelector('.calorie-placeholder-notice')) {
      const notice = document.createElement('div');
      notice.className = 'calorie-placeholder-notice';
      notice.innerHTML = '<strong>Calories still needed</strong><span>Enter the calorie amount and save to resolve this placeholder.</span>';
      form.insertAdjacentElement('afterbegin', notice);
    }
    return result;
  };

  const originalSaveEntryEdit = App.saveEntryEdit;
  App.saveEntryEdit = async function(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    if (!entry?.caloriesPending) return originalSaveEntryEdit.call(this, id);

    const raw = document.getElementById('editEntryCalories')?.value;
    const calories = Number(raw);
    if (raw === '' || !Number.isInteger(calories) || calories < 0) {
      return this.showToast('Enter whole-number calories of 0 or more');
    }

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'entries' && value?.id === id) {
        value = {
          ...value,
          caloriesPending: false,
          placeholder: false,
          baseCalories: calories,
          portionName: value.portionName === 'Calories pending' ? 'Manual' : value.portionName,
        };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      await originalSaveEntryEdit.call(this, id);
    } finally {
      db.put = originalPut;
    }
  };
})();
