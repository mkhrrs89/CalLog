setTimeout(() => {
  'use strict';

  if (!window.App || App.__savedFoodDefaultsHardeningInstalled) return;
  App.__savedFoodDefaultsHardeningInstalled = true;

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  const validConfidence = value => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['high', 'medium', 'low'].includes(normalized) ? normalized : '';
  };

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

  const defaultConfidenceFor = food => validConfidence(
    food?.defaultConfidence ?? food?.confidence ?? ''
  );

  const editorDefaults = payload => {
    const tagSelect = document.getElementById('foodEditDefaultMealTag');
    const confidenceSelect = document.getElementById('foodEditDefaultConfidence');
    const servingLabelInput = document.getElementById('foodEditServingLabel');
    const existing = payload?.existing || null;

    const tag = tagSelect
      ? resolveTag(tagSelect.value)
      : resolveTag(
          payload?.defaultMealTagId
            || payload?.defaultMealTagName
            || existing?.defaultMealTagId
            || existing?.defaultMealTagName
            || ''
        );

    const confidence = confidenceSelect
      ? validConfidence(confidenceSelect.value)
      : validConfidence(payload?.defaultConfidence ?? defaultConfidenceFor(existing));

    const servingLabel = servingLabelInput
      ? String(servingLabelInput.value ?? '')
      : String(payload?.servingLabel ?? existing?.servingLabel ?? '');

    return {
      defaultMealTagId: tag?.id || '',
      defaultMealTagName: tag?.name || '',
      defaultConfidence: confidence,
      servingLabel,
    };
  };

  const findJustSavedFood = (app, payload, existingId) => {
    if (existingId) return app.cache.foods.find(food => food.id === existingId) || null;

    const normalizedName = app.normalizeName(payload?.name || '');
    if (!normalizedName) return null;

    return [...app.cache.foods]
      .filter(food => app.normalizeName(food.name) === normalizedName)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0]
      || null;
  };

  // The inline food persistence routine predates these metadata fields and can
  // omit them. Verify the record AFTER that routine finishes and repair the
  // actual IndexedDB food record if anything was dropped or left stale.
  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const defaults = editorDefaults(payload);
    const existingId = payload?.existing?.id || payload?.id || '';

    // Also make the fields available to every older persistence wrapper.
    payload.defaultMealTagId = defaults.defaultMealTagId;
    payload.defaultMealTagName = defaults.defaultMealTagName;
    payload.defaultConfidence = defaults.defaultConfidence;
    payload.servingLabel = defaults.servingLabel;

    // Force all hardened metadata onto the actual food write. Older wrappers
    // may rebuild the food object and omit newer fields, so this sits outside
    // that chain and guarantees the final IndexedDB write receives them.
    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'foods' && value) {
        value = {
          ...value,
          defaultMealTagId: defaults.defaultMealTagId,
          defaultMealTagName: defaults.defaultMealTagName,
          defaultConfidence: defaults.defaultConfidence,
          servingLabel: defaults.servingLabel,
        };
      }
      return originalPut.call(this, storeName, value);
    };

    let result;
    try {
      result = await originalPersistFoodForm.call(this, payload);
    } finally {
      db.put = originalPut;
    }

    // The original save normally refreshes cache. Refresh defensively in case a
    // future persistence path changes that behavior.
    let food = findJustSavedFood(this, payload, existingId);
    if (!food) {
      await this.refreshCache();
      food = findJustSavedFood(this, payload, existingId);
    }
    if (!food) return result;

    const needsRepair = String(food.defaultMealTagId || '') !== defaults.defaultMealTagId
      || String(food.defaultMealTagName || '') !== defaults.defaultMealTagName
      || validConfidence(food.defaultConfidence) !== defaults.defaultConfidence
      || String(food.servingLabel ?? '') !== defaults.servingLabel;

    if (needsRepair) {
      await this.db.put('foods', {
        ...food,
        ...defaults,
        updatedAt: new Date().toISOString(),
      });
      await this.refreshCache();
      await this.render();
    }

    return result;
  };

  // Always present the saved defaults when a saved-food logging sheet opens.
  // Dataset flags distinguish the untouched default from an intentional one-off
  // override such as Untagged or Not specified.
  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return result;

    const tagSelect = document.getElementById('savedMealTag');
    if (tagSelect) {
      tagSelect.value = defaultTagFor(food)?.id || '';
      tagSelect.dataset.userSelected = 'false';
      if (tagSelect.dataset.hardenedDefaultTracking !== 'true') {
        tagSelect.dataset.hardenedDefaultTracking = 'true';
        tagSelect.addEventListener('change', () => {
          tagSelect.dataset.userSelected = 'true';
        });
      }
    }

    const confidenceSelect = document.getElementById('savedConfidence');
    if (confidenceSelect) {
      confidenceSelect.value = defaultConfidenceFor(food);
      confidenceSelect.dataset.userSelected = 'false';
      if (confidenceSelect.dataset.hardenedDefaultTracking !== 'true') {
        confidenceSelect.dataset.hardenedDefaultTracking = 'true';
        confidenceSelect.addEventListener('change', () => {
          confidenceSelect.dataset.userSelected = 'true';
        });
      }
    }

    return result;
  };

  // Final authority at the entry write. This means saved-food search, Quick
  // Log, the serving picker, and future callers all receive the same defaults.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    const storedFood = this.cache.foods.find(item => item.id === food?.id) || food;

    const tagExplicit = options.__mealTagSelectionExplicit === true
      || (this.__savedFoodTagWasExplicit === true && hasOwn(options, 'mealTagId'));
    const requestedTag = resolveTag(options.mealTagId);
    const tag = tagExplicit
      ? requestedTag
      : (requestedTag || defaultTagFor(storedFood));
    const mealTagId = tag?.id || '';

    const confidenceExplicit = options.__confidenceSelectionExplicit === true;
    const requestedConfidence = validConfidence(options.confidence);
    const confidence = confidenceExplicit
      ? requestedConfidence
      : (requestedConfidence || defaultConfidenceFor(storedFood));

    const nextOptions = {
      ...options,
      mealTagId,
      confidence,
      __mealTagSelectionExplicit: tagExplicit,
      __confidenceSelectionExplicit: confidenceExplicit,
    };

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'entries' && value?.foodId === storedFood?.id) {
        value = {
          ...value,
          mealTagId,
          mealTagSnapshot: tag ? { id: tag.id, name: tag.name, color: tag.color } : null,
          confidence,
        };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalLogSavedFood.call(this, storedFood, nextOptions);
    } finally {
      db.put = originalPut;
    }
  };

  // Keep the serving-sheet submit path deterministic too. Empty values only
  // mean an explicit override when the user actually changed that selector.
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
    const tagExplicit = tagSelect?.dataset.userSelected === 'true';
    const selectedTag = tagExplicit
      ? resolveTag(tagSelect?.value || '')
      : defaultTagFor(food);

    const confidenceSelect = document.getElementById('savedConfidence');
    const confidenceExplicit = confidenceSelect?.dataset.userSelected === 'true';
    const selectedConfidence = confidenceExplicit
      ? validConfidence(confidenceSelect?.value || '')
      : defaultConfidenceFor(food);

    await this.logSavedFood(food, {
      calories: Math.round(Number(portion.calories || 0) * multiplier),
      multiplier,
      portionName: portion.name,
      mealTagId: selectedTag?.id || '',
      __mealTagSelectionExplicit: tagExplicit,
      confidence: selectedConfidence,
      __confidenceSelectionExplicit: confidenceExplicit,
      note: document.getElementById('savedNote')?.value.trim() || '',
    });
  };
}, 0);
