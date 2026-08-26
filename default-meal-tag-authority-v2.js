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

  const validConfidence = value => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['high', 'medium', 'low'].includes(normalized) ? normalized : '';
  };

  const defaultConfidenceFor = food => validConfidence(
    food?.defaultConfidence ?? food?.confidence ?? ''
  );

  // Final editor authority for saved defaults. Both fields are guaranteed to
  // exist in the form regardless of which earlier enhancement built it.
  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    await originalOpenFoodEditor.call(this, id);

    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    let tagSelect = document.getElementById('foodEditDefaultMealTag');

    if (!tagSelect) {
      const pinnedLabel = document.getElementById('foodEditPinned')?.closest('label');
      if (pinnedLabel) {
        const label = document.createElement('label');
        label.innerHTML = `Default meal tag <span class="field-help">Automatically applied whenever this saved food is logged</span><select id="foodEditDefaultMealTag"><option value="">No default — log as Untagged</option>${this.cache.tags.map(tag => `<option value="${this.attr(tag.id)}">${this.esc(tag.name)}</option>`).join('')}</select>`;
        pinnedLabel.insertAdjacentElement('afterend', label);
        tagSelect = document.getElementById('foodEditDefaultMealTag');
      }
    }

    const savedTag = defaultTagFor(food);
    if (tagSelect) tagSelect.value = savedTag?.id || '';

    let confidenceSelect = document.getElementById('foodEditDefaultConfidence');
    if (!confidenceSelect) {
      const anchor = tagSelect?.closest('label') || document.getElementById('foodEditPinned')?.closest('label');
      if (anchor) {
        const label = document.createElement('label');
        label.innerHTML = `Confidence level <span class="field-help">Default confidence when this food is logged</span><select id="foodEditDefaultConfidence"><option value="">Not specified</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>`;
        anchor.insertAdjacentElement('afterend', label);
        confidenceSelect = document.getElementById('foodEditDefaultConfidence');
      }
    }

    if (confidenceSelect) confidenceSelect.value = defaultConfidenceFor(food);
  };

  // Read the visible selectors last so mobile/desktop use the exact values the
  // user actually sees, then carry them through every later save wrapper.
  const originalCollectFoodForm = App.collectFoodForm;
  App.collectFoodForm = function(id) {
    const payload = originalCollectFoodForm.call(this, id);

    const tagSelect = document.getElementById('foodEditDefaultMealTag');
    const tag = tagSelect ? resolveTag(tagSelect.value) : defaultTagFor(payload.existing);
    payload.defaultMealTagId = tag?.id || '';
    payload.defaultMealTagName = tag?.name || '';

    const confidenceSelect = document.getElementById('foodEditDefaultConfidence');
    payload.defaultConfidence = confidenceSelect
      ? validConfidence(confidenceSelect.value)
      : defaultConfidenceFor(payload.existing);

    return payload;
  };

  // Final food-write authority. The object that reaches IndexedDB always gets
  // both saved defaults, even if an older persistence wrapper omits them.
  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const tagSelect = document.getElementById('foodEditDefaultMealTag');
    const tag = tagSelect
      ? resolveTag(tagSelect.value)
      : resolveTag(
          payload?.defaultMealTagId
            || payload?.defaultMealTagName
            || payload?.existing?.defaultMealTagId
            || payload?.existing?.defaultMealTagName
            || ''
        );

    const confidenceSelect = document.getElementById('foodEditDefaultConfidence');
    const defaultConfidence = confidenceSelect
      ? validConfidence(confidenceSelect.value)
      : validConfidence(payload?.defaultConfidence ?? defaultConfidenceFor(payload?.existing));

    const defaultMealTagId = tag?.id || '';
    const defaultMealTagName = tag?.name || '';
    payload.defaultMealTagId = defaultMealTagId;
    payload.defaultMealTagName = defaultMealTagName;
    payload.defaultConfidence = defaultConfidence;

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'foods' && value) {
        value = {
          ...value,
          defaultMealTagId,
          defaultMealTagName,
          defaultConfidence,
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

  // The saved-food logger starts from both stored defaults. Change tracking is
  // what allows a one-off manual override, including Untagged/Not specified.
  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return result;

    const tagSelect = document.getElementById('savedMealTag');
    if (tagSelect) {
      tagSelect.value = defaultTagFor(food)?.id || '';
      tagSelect.dataset.userSelected = 'false';
      if (tagSelect.dataset.savedDefaultsTracking !== 'true') {
        tagSelect.dataset.savedDefaultsTracking = 'true';
        tagSelect.addEventListener('change', () => {
          tagSelect.dataset.userSelected = 'true';
        });
      }
    }

    const confidenceSelect = document.getElementById('savedConfidence');
    if (confidenceSelect) {
      confidenceSelect.value = defaultConfidenceFor(food);
      confidenceSelect.dataset.userSelected = 'false';
      if (confidenceSelect.dataset.savedDefaultsTracking !== 'true') {
        confidenceSelect.dataset.savedDefaultsTracking = 'true';
        confidenceSelect.addEventListener('change', () => {
          confidenceSelect.dataset.userSelected = 'true';
        });
      }
    }

    return result;
  };

  // Final logging authority. Both saved defaults are resolved again from the
  // food record immediately before the entry write. This covers saved-food
  // search, Quick Log, and the serving modal on both mobile and desktop.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    const tagExplicit = options.__mealTagSelectionExplicit === true
      || (this.__savedFoodTagWasExplicit === true && hasOwn(options, 'mealTagId'));
    const requestedTag = resolveTag(options.mealTagId);
    const tag = tagExplicit ? requestedTag : (requestedTag || defaultTagFor(food));
    const mealTagId = tag?.id || '';

    const confidenceExplicit = options.__confidenceSelectionExplicit === true;
    const requestedConfidence = validConfidence(options.confidence);
    const confidence = confidenceExplicit
      ? requestedConfidence
      : (requestedConfidence || defaultConfidenceFor(food));

    const nextOptions = {
      ...options,
      mealTagId,
      confidence,
      __mealTagSelectionExplicit: tagExplicit,
      __confidenceSelectionExplicit: confidenceExplicit,
    };

    const previousExplicitState = this.__savedFoodTagWasExplicit;
    this.__savedFoodTagWasExplicit = tagExplicit && !mealTagId;

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'entries' && value?.foodId === food?.id) {
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
      return await originalLogSavedFood.call(this, food, nextOptions);
    } finally {
      db.put = originalPut;
      this.__savedFoodTagWasExplicit = previousExplicitState;
    }
  };

  // Deterministic modal submit path. Empty UI values are only treated as an
  // intentional override when the user actually changed that selector.
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

    const confidenceSelect = document.getElementById('savedConfidence');
    const userSelectedConfidence = confidenceSelect?.dataset.userSelected === 'true';
    const selectedConfidence = userSelectedConfidence
      ? validConfidence(confidenceSelect?.value || '')
      : defaultConfidenceFor(food);

    await this.logSavedFood(food, {
      calories: Math.round(Number(portion.calories || 0) * multiplier),
      multiplier,
      portionName: portion.name,
      mealTagId: selectedTag?.id || '',
      __mealTagSelectionExplicit: userSelectedTag,
      confidence: selectedConfidence,
      __confidenceSelectionExplicit: userSelectedConfidence,
      note: document.getElementById('savedNote')?.value.trim() || '',
    });
  };
}, 0);

import('./copy-entry-to-date.js').catch(() => {});
