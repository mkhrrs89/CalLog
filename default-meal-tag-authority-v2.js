setTimeout(() => {
  'use strict';

  if (!window.App || App.__defaultMealTagAuthorityV2Installed) return;
  App.__defaultMealTagAuthorityV2Installed = true;

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  const resolveTagId = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const byId = App.cache.tags.find(tag => tag.id === raw);
    if (byId) return byId.id;
    const lower = raw.toLowerCase();
    return App.cache.tags.find(tag => String(tag.name || '').trim().toLowerCase() === lower)?.id || '';
  };

  const defaultTagIdFor = food => resolveTagId(
    food?.defaultMealTagId || food?.defaultMealTag || food?.defaultMealTagName || ''
  );

  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const select = document.getElementById('savedMealTag');
    if (!select || !food) return result;

    const defaultTagId = defaultTagIdFor(food);
    select.value = defaultTagId;
    select.dataset.userSelected = 'false';

    if (select.dataset.defaultMealAuthorityV2Tracking !== 'true') {
      select.dataset.defaultMealAuthorityV2Tracking = 'true';
      select.addEventListener('change', () => {
        select.dataset.userSelected = 'true';
      });
    }

    return result;
  };

  // Final authority for saved-food logging. Older wrappers can still prepare
  // options, but immediately before IndexedDB stores the new entry we enforce
  // the saved food's default tag unless the user explicitly chose a tag (or
  // explicitly chose Untagged) in the logging modal.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    const explicitlySelected = options.__mealTagSelectionExplicit === true
      || (this.__savedFoodTagWasExplicit === true && hasOwn(options, 'mealTagId'));
    const requestedTagId = resolveTagId(options.mealTagId);
    const mealTagId = explicitlySelected
      ? requestedTagId
      : (requestedTagId || defaultTagIdFor(food));
    const tag = this.cache.tags.find(item => item.id === mealTagId) || null;

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

    await this.logSavedFood(food, {
      calories: Math.round(Number(portion.calories || 0) * multiplier),
      multiplier,
      portionName: portion.name,
      mealTagId: userSelectedTag ? (tagSelect?.value || '') : defaultTagIdFor(food),
      __mealTagSelectionExplicit: userSelectedTag,
      confidence: document.getElementById('savedConfidence')?.value || '',
      note: hasOwn(optionsSafeNote(), 'note') ? optionsSafeNote().note : String(food.notes || ''),
    });
  };

  function optionsSafeNote() {
    const note = document.getElementById('savedNote');
    return note ? { note: note.value.trim() } : {};
  }

  const originalLogFoodQuick = App.logFoodQuick;
  App.logFoodQuick = async function(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return originalLogFoodQuick.call(this, id);
    if ((food.portions || []).length) return this.openSavedFoodLogger(id);

    await this.logSavedFood(food, {
      calories: food.calories,
      multiplier: 1,
      portionName: 'Default',
      mealTagId: defaultTagIdFor(food),
      note: String(food.notes || ''),
    });
  };
}, 0);

import('./copy-entry-to-date.js').catch(() => {});
