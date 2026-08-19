setTimeout(() => {
  'use strict';

  if (!window.App || App.__defaultMealTagAuthorityV2Installed) return;
  App.__defaultMealTagAuthorityV2Installed = true;

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  const resolveTag = value => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const byId = App.cache.tags.find(tag => tag.id === raw);
    if (byId) return byId;

    const lower = raw.toLowerCase();
    return App.cache.tags.find(tag => String(tag.name || '').trim().toLowerCase() === lower) || null;
  };

  const defaultTagFor = food => resolveTag(
    food?.defaultMealTagId
      || food?.defaultMealTagName
      || food?.defaultMealTag
      || ''
  );

  // Final editor authority. Even if earlier enhancements rebuild or wrap the
  // food editor, make sure the saved default tag is represented by the final
  // form that the user actually sees.
  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    await originalOpenFoodEditor.call(this, id);

    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    let select = document.getElementById('foodEditDefaultMealTag');

    if (!select) {
      const pinnedLabel = document.getElementById('foodEditPinned')?.closest('label');
      if (!pinnedLabel) return;

      const label = document.createElement('label');
      label.innerHTML = `Default meal tag <span class="field-help">Automatically applied whenever this saved food is logged</span><select id="foodEditDefaultMealTag"><option value="">No default — log as Untagged</option>${this.cache.tags.map(tag => `<option value="${this.attr(tag.id)}">${this.esc(tag.name)}</option>`).join('')}</select>`;
      pinnedLabel.insertAdjacentElement('afterend', label);
      select = document.getElementById('foodEditDefaultMealTag');
    }

    const savedTag = defaultTagFor(food);
    if (select) select.value = savedTag?.id || '';
  };

  // Read the visible selector last, after every other food-form enhancement.
  // Store both ID and name so a recreated tag with the same name can still be
  // recovered if its internal ID ever changes.
  const originalCollectFoodForm = App.collectFoodForm;
  App.collectFoodForm = function(id) {
    const payload = originalCollectFoodForm.call(this, id);
    const select = document.getElementById('foodEditDefaultMealTag');
    const tag = select
      ? resolveTag(select.value)
      : defaultTagFor(payload.existing);

    payload.defaultMealTagId = tag?.id || '';
    payload.defaultMealTagName = tag?.name || '';
    return payload;
  };

  // Final food-write authority. The inline food saver and other metadata
  // enhancements may construct their own record, but the object that actually
  // reaches IndexedDB always receives the default meal tag selected above.
  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const select = document.getElementById('foodEditDefaultMealTag');
    const tag = select
      ? resolveTag(select.value)
      : resolveTag(
          payload?.defaultMealTagId
            || payload?.defaultMealTagName
            || payload?.existing?.defaultMealTagId
            || payload?.existing?.defaultMealTagName
            || ''
        );

    const defaultMealTagId = tag?.id || '';
    const defaultMealTagName = tag?.name || '';
    payload.defaultMealTagId = defaultMealTagId;
    payload.defaultMealTagName = defaultMealTagName;

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'foods' && value) {
        value = {
          ...value,
          defaultMealTagId,
          defaultMealTagName,
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

  // The logging modal always starts from the food record's saved default. A
  // change listener distinguishes a real user override (including Untagged)
  // from an empty value passed through older logging code.
  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const select = document.getElementById('savedMealTag');
    if (!select || !food) return result;

    select.value = defaultTagFor(food)?.id || '';
    select.dataset.userSelected = 'false';

    if (select.dataset.defaultMealAuthorityV2Tracking !== 'true') {
      select.dataset.defaultMealAuthorityV2Tracking = 'true';
      select.addEventListener('change', () => {
        select.dataset.userSelected = 'true';
      });
    }

    return result;
  };

  // Final saved-food logging authority. Immediately before the entry write,
  // derive the meal tag from the saved food unless the user explicitly changed
  // the selector for this one log. This is independent of whether that meal
  // group already has entries on the destination day.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    const explicitlySelected = options.__mealTagSelectionExplicit === true
      || (this.__savedFoodTagWasExplicit === true && hasOwn(options, 'mealTagId'));
    const requestedTag = resolveTag(options.mealTagId);
    const tag = explicitlySelected
      ? requestedTag
      : (requestedTag || defaultTagFor(food));
    const mealTagId = tag?.id || '';

    const nextOptions = {
      ...options,
      mealTagId,
      __mealTagSelectionExplicit: explicitlySelected,
    };

    const previousExplicitState = this.__savedFoodTagWasExplicit;
    this.__savedFoodTagWasExplicit = explicitlySelected && !mealTagId;

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'entries' && value?.foodId === food?.id) {
        value = {
          ...value,
          mealTagId,
          mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
        };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalLogSavedFood.call(this, food, nextOptions);
    } finally {
      db.put = originalPut;
      this.__savedFoodTagWasExplicit = previousExplicitState;
    }
  };

  // Make the normal saved-food submit path deterministic. Confidence, notes,
  // serving labels, multipliers, and saved portions continue to flow through
  // their existing enhancements unchanged.
  App.submitSavedFoodLog = async function(foodId) {
    const food = this.cache.foods.find(item => item.id === foodId);
    if (!food) return;

    const portions = [
      { id: 'default', name: 'Default', calories: food.calories },
      ...(food.portions || []),
    ];
    const portion = portions[Number(document.getElementById('savedPortion')?.value || 0)] || portions[0];
    const multiplier = Math.max(0, Number(document.getElementById('savedMultiplier')?.value || 1));
    const tagSelect = document.getElementById('savedMealTag');
    const userSelectedTag = tagSelect?.dataset.userSelected === 'true';
    const selectedTag = userSelectedTag
      ? resolveTag(tagSelect?.value || '')
      : defaultTagFor(food);

    await this.logSavedFood(food, {
      calories: Math.round(Number(portion.calories || 0) * multiplier),
      multiplier,
      portionName: portion.name,
      mealTagId: selectedTag?.id || '',
      __mealTagSelectionExplicit: userSelectedTag,
      confidence: document.getElementById('savedConfidence')?.value || '',
      note: document.getElementById('savedNote')?.value.trim() || '',
    });
  };
}, 0);

import('./copy-entry-to-date.js').catch(() => {});
