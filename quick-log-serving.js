setTimeout(() => {
  'use strict';

  if (!window.App || App.__quickLogServingInstalled) return;
  App.__quickLogServingInstalled = true;

  const normalizeMode = value => ['ask', 'default', 'saved'].includes(String(value || ''))
    ? String(value)
    : 'ask';

  const savedPortionFor = food => {
    if (normalizeMode(food?.quickLogServingMode) !== 'saved') return null;
    const wanted = String(food?.quickLogPortionName || '').trim();
    if (!wanted) return null;
    return (food?.portions || []).find(portion => String(portion.name || '').trim() === wanted) || null;
  };

  const settingFor = food => ({
    mode: normalizeMode(food?.quickLogServingMode),
    portionName: String(food?.quickLogPortionName || ''),
  });

  const optionValueFor = setting => {
    if (setting.mode === 'default') return 'default';
    if (setting.mode === 'saved' && setting.portionName) return `saved:${setting.portionName}`;
    return 'ask';
  };

  const refreshEditorOptions = (food = null, preserveCurrent = true) => {
    const select = document.getElementById('foodEditQuickLogServing');
    const portionsInput = document.getElementById('foodEditPortions');
    if (!select || !portionsInput) return;

    const previous = preserveCurrent ? select.value : optionValueFor(settingFor(food));
    let portions = [];
    try {
      portions = App.parsePortions(portionsInput.value || '');
    } catch (_) {
      portions = [];
    }

    const defaultCalories = Math.max(0, Number(document.getElementById('foodEditCalories')?.value || food?.calories || 0));
    const servingLabel = String(document.getElementById('foodEditServingLabel')?.value || food?.servingLabel || '').trim();

    select.innerHTML = '';

    const ask = document.createElement('option');
    ask.value = 'ask';
    ask.textContent = portions.length
      ? 'Ask each time (current behavior)'
      : 'Normal one-tap default serving';
    select.appendChild(ask);

    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = `Default${servingLabel ? ` (${servingLabel})` : ''} — ${App.formatNumber(defaultCalories)} cal`;
    select.appendChild(defaultOption);

    const seen = new Set();
    for (const portion of portions) {
      const name = String(portion.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const option = document.createElement('option');
      option.value = `saved:${name}`;
      option.textContent = `${name} — ${App.formatNumber(portion.calories)} cal`;
      select.appendChild(option);
    }

    const available = [...select.options].some(option => option.value === previous);
    select.value = available ? previous : 'ask';
  };

  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    await originalOpenFoodEditor.call(this, id);
    if (document.getElementById('foodEditQuickLogServing')) return;

    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    const portionsInput = document.getElementById('foodEditPortions');
    const portionsLabel = portionsInput?.closest('label');
    if (!portionsLabel) return;

    const label = document.createElement('label');
    label.innerHTML = `Quick Log serving <span class="field-help">Choose what one tap logs when this food is pinned on Today</span><select id="foodEditQuickLogServing"></select>`;
    portionsLabel.insertAdjacentElement('afterend', label);

    refreshEditorOptions(food, false);

    portionsInput.addEventListener('input', () => refreshEditorOptions(food, true));
    document.getElementById('foodEditCalories')?.addEventListener('input', () => refreshEditorOptions(food, true));
    document.getElementById('foodEditServingLabel')?.addEventListener('input', () => refreshEditorOptions(food, true));
  };

  const originalCollectFoodForm = App.collectFoodForm;
  App.collectFoodForm = function(id) {
    const payload = originalCollectFoodForm.call(this, id);
    const select = document.getElementById('foodEditQuickLogServing');
    const existingSetting = settingFor(payload.existing);
    const value = select?.value || optionValueFor(existingSetting);

    if (value === 'default') {
      payload.quickLogServingMode = 'default';
      payload.quickLogPortionName = '';
    } else if (value.startsWith('saved:')) {
      payload.quickLogServingMode = 'saved';
      payload.quickLogPortionName = value.slice('saved:'.length);
    } else {
      payload.quickLogServingMode = 'ask';
      payload.quickLogPortionName = '';
    }

    return payload;
  };

  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const db = this.db;
    const originalPut = db.put;
    const existing = payload?.existing || null;
    const existingSetting = settingFor(existing);
    const mode = normalizeMode(payload?.quickLogServingMode ?? existingSetting.mode);
    const portionName = mode === 'saved'
      ? String(payload?.quickLogPortionName ?? existingSetting.portionName).trim()
      : '';

    db.put = function(storeName, value) {
      if (storeName === 'foods' && value) {
        value = {
          ...value,
          quickLogServingMode: mode,
          quickLogPortionName: portionName,
        };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalPersistFoodForm.call(this, payload);
    } finally {
      db.put = originalPut;
    }
  };

  const originalQuickFoodHtml = App.quickFoodHtml;
  App.quickFoodHtml = function(food) {
    const mode = normalizeMode(food?.quickLogServingMode);
    const portion = savedPortionFor(food);
    if (mode !== 'saved' || !portion) return originalQuickFoodHtml.call(this, food);

    return `
      <div class="quick-food">
        <button class="quick-food-main" onclick="App.logFoodQuick('${this.attr(food.id)}')">
          <strong>${this.esc(food.name)}</strong>
          <span class="tiny muted">${this.esc(portion.name)} · ${this.formatNumber(portion.calories)} cal</span>
        </button>
        <button class="quick-food-more" onclick="App.openSavedFoodLogger('${this.attr(food.id)}')" aria-label="Portions and multiplier">⋯</button>
      </div>`;
  };

  const originalLogFoodQuick = App.logFoodQuick;
  App.logFoodQuick = async function(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return originalLogFoodQuick.call(this, id);

    const mode = normalizeMode(food.quickLogServingMode);
    if (mode === 'ask') return originalLogFoodQuick.call(this, id);

    if (mode === 'default') {
      return this.logSavedFood(food, {
        calories: Math.max(0, Number(food.calories || 0)),
        multiplier: 1,
        portionName: 'Default',
      });
    }

    const portion = savedPortionFor(food);
    if (!portion) {
      this.openSavedFoodLogger(id);
      this.showToast('Saved Quick Log portion no longer exists; choose a serving');
      return;
    }

    return this.logSavedFood(food, {
      calories: Math.max(0, Number(portion.calories || 0)),
      multiplier: 1,
      portionName: portion.name || 'Saved portion',
    });
  };
}, 0);
