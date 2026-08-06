setTimeout(() => {
  'use strict';

  if (!window.App || App.__foodMetadataCarryoverFixInstalled) return;
  App.__foodMetadataCarryoverFixInstalled = true;

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const validDefaultTagId = food => {
    const id = String(food?.defaultMealTagId || '');
    return App.cache.tags.some(tag => tag.id === id) ? id : '';
  };

  // This runs after the inline food editor enhancements. Preserve every food
  // metadata field that those later save overrides previously omitted.
  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const db = this.db;
    const originalPut = db.put;
    const existing = payload?.existing || null;

    db.put = function(storeName, value) {
      if (storeName === 'foods' && value) {
        value = {
          ...value,
          notes: String(payload?.notes ?? value.notes ?? existing?.notes ?? ''),
          defaultMealTagId: String(
            payload?.defaultMealTagId ?? value.defaultMealTagId ?? existing?.defaultMealTagId ?? ''
          ),
          servingLabel: String(
            payload?.servingLabel ?? value.servingLabel ?? existing?.servingLabel ?? ''
          ),
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

  // Populate the per-log note field from the saved food. The user can still
  // edit or clear it before logging that individual entry.
  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const note = document.getElementById('savedNote');
    if (note && food) note.value = String(food.notes || '');
    return result;
  };

  // Quick Log does not open the logger, so copy saved notes and the default
  // meal tag here as well. Explicit selections in the logger still win.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = function(food, options = {}) {
    const explicitMealSelection = options.__mealTagSelectionExplicit === true
      || (this.__savedFoodTagWasExplicit === true && hasOwn(options, 'mealTagId'));
    const mealTagId = explicitMealSelection
      ? String(options.mealTagId || '')
      : String(options.mealTagId || validDefaultTagId(food));

    const nextOptions = { ...options, mealTagId };
    if (!hasOwn(options, 'note')) nextOptions.note = String(food?.notes || '');

    return originalLogSavedFood.call(this, food, nextOptions);
  };
}, 0);
