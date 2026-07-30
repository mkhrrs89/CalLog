(() => {
  const inferLoggedPortionCalories = entry => {
    const stored = Number(entry.portionCalories);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    const multiplier = Number(entry.multiplier);
    const base = Number(entry.baseCalories);
    if ((entry.portionName || '').toLowerCase() === 'default' && Number.isFinite(base) && base >= 0) return base;
    if (Number.isFinite(multiplier) && multiplier > 0) return Math.max(0, Number(entry.calories || 0) / multiplier);
    return Number.isFinite(base) && base >= 0 ? base : Math.max(0, Number(entry.calories || 0));
  };

  const entryServingSetup = entry => {
    const food = App.cache.foods.find(item => item.id === entry.foodId) || null;
    const name = entry.portionName || (food ? 'Default' : 'Manual');
    const calories = inferLoggedPortionCalories(entry);
    const rawMultiplier = Number(entry.multiplier);
    const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier >= 0 ? rawMultiplier : 1;
    const portions = food ? [
      { name: 'Default', calories: Math.max(0, Number(food.calories || 0)) },
      ...(food.portions || []).map(item => ({ name: item.name || 'Serving', calories: Math.max(0, Number(item.calories || 0)) })),
    ] : [];
    let selectedIndex = portions.findIndex(item => item.name.toLowerCase() === name.toLowerCase() && Math.abs(item.calories - calories) <= 0.5);
    if (selectedIndex < 0) {
      portions.push({ name, calories, logged: true });
      selectedIndex = portions.length - 1;
    }
    return { food, portions, selectedIndex, multiplier, calories };
  };

  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(id) {
    originalOpenEntryEditor.call(this, id);
    const entry = this.cache.entries.find(item => item.id === id);
    const form = document.querySelector('#modalContent form');
    const tagLabel = document.getElementById('editEntryTag')?.closest('label');
    if (!entry || !form || !tagLabel || document.getElementById('editEntryMultiplier')) return;
    const serving = entryServingSetup(entry);
    const portionField = serving.food
      ? `<label>Serving size<select id="editEntryPortion" onchange="App.updateEntryServingCalculation('${entry.id}')">${serving.portions.map((portion, index) => `<option value="${index}" ${index === serving.selectedIndex ? 'selected' : ''}>${this.esc(portion.name)} — ${this.formatNumber(portion.calories)} cal${portion.logged ? ' (logged)' : ''}</option>`).join('')}</select></label>`
      : `<label>Serving name<input id="editEntryPortionName" value="${this.attr(entry.portionName || 'Manual')}" /></label><label>Calories per serving<input id="editEntryPortionCalories" type="number" min="0" step="0.1" value="${Number(serving.calories.toFixed(2))}" oninput="App.updateEntryServingCalculation('${entry.id}')" /></label>`;
    const card = document.createElement('div');
    card.className = 'card subtle';
    card.innerHTML = `<h3>Serving</h3><div class="form-grid two">${portionField}<label>Number of servings<input id="editEntryMultiplier" type="number" min="0" step="0.1" value="${serving.multiplier}" oninput="App.updateEntryServingCalculation('${entry.id}')" /></label></div><div class="actions" style="margin-top:.55rem">${[0.5, 1, 1.5, 2].map(value => `<button type="button" class="chip ${Math.abs(serving.multiplier - value) < 0.001 ? 'active' : ''}" onclick="App.setEntryMultiplier(${value},this,'${entry.id}')">${value}×</button>`).join('')}</div><div class="row space small" style="margin-top:.65rem"><span class="muted">Calculated total</span><strong id="editEntryCalculatedCalories">${this.formatNumber(entry.calories)} cal</strong></div><p class="field-help" style="margin:.35rem 0 0">Changing the serving recalculates calories for this log only. The calorie field above still works normally.</p>`;
    form.insertBefore(card, tagLabel);
    const caloriesInput = document.getElementById('editEntryCalories');
    if (caloriesInput) caloriesInput.addEventListener('input', () => { caloriesInput.dataset.manual = 'true'; });
  };

  App.setEntryMultiplier = (value, button, entryId) => {
    const input = document.getElementById('editEntryMultiplier');
    if (input) input.value = value;
    button?.parentElement?.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
    button?.classList.add('active');
    App.updateEntryServingCalculation(entryId);
  };

  App.updateEntryServingCalculation = entryId => {
    const entry = App.cache.entries.find(item => item.id === entryId);
    if (!entry) return;
    const serving = entryServingSetup(entry);
    const multiplier = Number(document.getElementById('editEntryMultiplier')?.value);
    const select = document.getElementById('editEntryPortion');
    const portionCalories = select
      ? Number((serving.portions[Number(select.value)] || serving.portions[serving.selectedIndex])?.calories || 0)
      : Number(document.getElementById('editEntryPortionCalories')?.value);
    if (!Number.isFinite(multiplier) || multiplier < 0 || !Number.isFinite(portionCalories) || portionCalories < 0) return;
    const calories = Math.round(portionCalories * multiplier);
    const caloriesInput = document.getElementById('editEntryCalories');
    if (caloriesInput) {
      caloriesInput.value = calories;
      caloriesInput.dataset.manual = 'false';
    }
    const total = document.getElementById('editEntryCalculatedCalories');
    if (total) total.textContent = `${App.formatNumber(calories)} cal`;
    document.querySelectorAll('#modalContent .chip').forEach(chip => {
      chip.classList.toggle('active', Math.abs(Number(chip.textContent.replace('×', '')) - multiplier) < 0.001);
    });
  };

  const originalSaveEntryEdit = App.saveEntryEdit;
  App.saveEntryEdit = async function(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    if (!entry) return;
    const multiplier = Number(document.getElementById('editEntryMultiplier')?.value);
    if (!Number.isFinite(multiplier) || multiplier < 0) return this.showToast('Enter a serving amount of 0 or more');
    const serving = entryServingSetup(entry);
    const select = document.getElementById('editEntryPortion');
    let portionName;
    let portionCalories;
    if (select) {
      const selected = serving.portions[Number(select.value)] || serving.portions[serving.selectedIndex];
      portionName = selected?.name || 'Default';
      portionCalories = Number(selected?.calories || 0);
    } else {
      portionName = document.getElementById('editEntryPortionName')?.value.trim() || entry.portionName || 'Manual';
      portionCalories = Number(document.getElementById('editEntryPortionCalories')?.value);
      if (!Number.isFinite(portionCalories) || portionCalories < 0) return this.showToast('Enter calories per serving of 0 or more');
    }
    const caloriesInput = document.getElementById('editEntryCalories');
    const calories = Number(caloriesInput?.value);
    if (caloriesInput?.dataset.manual === 'true' && Number.isFinite(calories) && calories >= 0 && multiplier > 0) portionCalories = calories / multiplier;
    entry.multiplier = multiplier;
    entry.portionName = portionName;
    entry.portionCalories = Math.max(0, portionCalories);
    await originalSaveEntryEdit.call(this, id);
  };
})();

(() => {
  const originalEntriesHtml = App.entriesHtml;
  App.entriesHtml = function(entries) {
    if (this.view.entryView !== 'grouped' || !entries.length) {
      return originalEntriesHtml.call(this, entries);
    }

    const tags = this.tagMap();
    const currentGroups = new Map(this.cache.tags.map(tag => [tag.id, []]));
    const currentByName = new Map(this.cache.tags.map(tag => [tag.name.trim().toLowerCase(), tag]));
    const historicalGroups = new Map();
    const untagged = [];

    for (const entry of entries) {
      const currentTag = tags.get(entry.mealTagId);
      if (currentTag && currentGroups.has(currentTag.id)) {
        currentGroups.get(currentTag.id).push(entry);
        continue;
      }

      const snapshotName = entry.mealTagSnapshot?.name?.trim() || '';
      if (snapshotName) {
        const matchingCurrentTag = currentByName.get(snapshotName.toLowerCase());
        if (matchingCurrentTag) {
          currentGroups.get(matchingCurrentTag.id).push(entry);
        } else {
          const key = snapshotName.toLowerCase();
          if (!historicalGroups.has(key)) historicalGroups.set(key, { name: snapshotName, items: [] });
          historicalGroups.get(key).items.push(entry);
        }
      } else {
        untagged.push(entry);
      }
    }

    const orderedGroups = this.cache.tags
      .map(tag => ({ name: tag.name, items: currentGroups.get(tag.id) || [] }))
      .filter(group => group.items.length);
    orderedGroups.push(...historicalGroups.values());
    if (untagged.length) orderedGroups.push({ name: 'Untagged', items: untagged });

    return orderedGroups.map(group => `
      <div class="group-head">${this.esc(group.name)}</div>
      <div class="entry-list">${group.items.map(entry => this.entryRowHtml(entry, tags)).join('')}</div>`).join('');
  };

  const originalRenderSettings = App.renderSettings;
  App.renderSettings = async function() {
    const html = await originalRenderSettings.call(this);
    const addTagButton = '<button class="btn primary" onclick="App.openMealTagEditor()">Add tag</button>';
    if (!html.includes(addTagButton)) return html;
    const reorderButton = this.cache.tags.length > 1
      ? '<button class="btn ghost" onclick="App.openMealTagReorder()">Reorder</button>'
      : '';
    return html.replace(addTagButton, `<div class="actions">${reorderButton}${addTagButton}</div>`);
  };

  App.openMealTagReorder = function() {
    const tags = this.cache.tags;
    this.showModal(`
      <div class="row space"><div><div class="eyebrow">Settings order</div><h2>Reorder meal tags</h2></div><button class="icon-btn" onclick="App.closeModal()">×</button></div>
      <p>Grouped food logs follow this order. Untagged entries always appear last.</p>
      ${tags.length ? `<div class="stack">${tags.map((tag, index) => `
        <div class="tag-manager-row" style="grid-template-columns:auto minmax(0,1fr) auto">
          <span class="color-dot" style="background:${this.attr(tag.color)}"></span>
          <strong>${this.esc(tag.name)}</strong>
          <div class="actions" style="flex-wrap:nowrap">
            <button class="icon-btn" type="button" onclick="App.moveMealTag('${tag.id}',-1)" aria-label="Move ${this.attr(tag.name)} up" ${index === 0 ? 'disabled style="opacity:.35"' : ''}>↑</button>
            <button class="icon-btn" type="button" onclick="App.moveMealTag('${tag.id}',1)" aria-label="Move ${this.attr(tag.name)} down" ${index === tags.length - 1 ? 'disabled style="opacity:.35"' : ''}>↓</button>
          </div>
        </div>`).join('')}</div>` : '<div class="empty-state">No meal tags to reorder.</div>'}
      <div class="actions" style="margin-top:.9rem"><button class="btn primary" onclick="App.closeModal()">Done</button></div>`);
  };

  App.moveMealTag = async function(id, direction) {
    const tags = [...this.cache.tags];
    const fromIndex = tags.findIndex(tag => tag.id === id);
    const toIndex = fromIndex + (direction < 0 ? -1 : 1);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= tags.length) return;

    [tags[fromIndex], tags[toIndex]] = [tags[toIndex], tags[fromIndex]];
    const updatedAt = new Date().toISOString();
    await this.db.putMany('mealTags', tags.map((tag, index) => ({ ...tag, order: index, updatedAt })));
    await this.refreshCache();
    if (this.view.page === 'settings') await this.render();
    this.openMealTagReorder();
  };
})();

(() => {
  const originalRenderToday = App.renderToday;
  App.renderToday = async function() {
    const html = await originalRenderToday.call(this);
    const pinned = this.cache.foods
      .filter(food => food.pinned)
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
    if (pinned.length <= 8) return html;

    const extraTiles = pinned.slice(8).map(food => this.quickFoodHtml(food)).join('');
    return html.replace(
      /(<div class="quick-grid">[\s\S]*?)(<\/div>\s*<\/section>\s*<section class="section">)/,
      `$1${extraTiles}$2`
    );
  };
})();

setTimeout(() => {
  if (App.__defaultMealTagInstalled) return;
  App.__defaultMealTagInstalled = true;

  const validDefaultTagId = food => {
    const id = food?.defaultMealTagId || '';
    return App.cache.tags.some(tag => tag.id === id) ? id : '';
  };

  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    await originalOpenFoodEditor.call(this, id);
    if (document.getElementById('foodEditDefaultMealTag')) return;
    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    const pinnedLabel = document.getElementById('foodEditPinned')?.closest('label');
    const form = document.querySelector('#modalContent form');
    if (!form || !pinnedLabel) return;

    const selectedId = validDefaultTagId(food);
    const label = document.createElement('label');
    label.innerHTML = `Default meal tag <span class="field-help">Automatically applied whenever this saved food is logged</span><select id="foodEditDefaultMealTag"><option value="">No default — log as Untagged</option>${this.cache.tags.map(tag => `<option value="${this.attr(tag.id)}" ${tag.id === selectedId ? 'selected' : ''}>${this.esc(tag.name)}</option>`).join('')}</select>`;
    pinnedLabel.insertAdjacentElement('afterend', label);
  };

  const originalCollectFoodForm = App.collectFoodForm;
  App.collectFoodForm = function(id) {
    const payload = originalCollectFoodForm.call(this, id);
    payload.defaultMealTagId = document.getElementById('foodEditDefaultMealTag')?.value || '';
    return payload;
  };

  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'foods') value = { ...value, defaultMealTagId: payload.defaultMealTagId || '' };
      return originalPut.call(this, storeName, value);
    };
    try {
      await originalPersistFoodForm.call(this, payload);
    } finally {
      db.put = originalPut;
    }
  };

  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const select = document.getElementById('savedMealTag');
    if (select) select.value = validDefaultTagId(food);
  };

  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = function(food, options = {}) {
    const hasExplicitTag = Object.prototype.hasOwnProperty.call(options, 'mealTagId');
    const mealTagId = hasExplicitTag ? (options.mealTagId || '') : validDefaultTagId(food);
    return originalLogSavedFood.call(this, food, { ...options, mealTagId });
  };
}, 0);
