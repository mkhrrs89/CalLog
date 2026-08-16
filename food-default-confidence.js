setTimeout(() => {
  'use strict';

  if (!window.App || App.__foodDefaultConfidenceInstalled) return;
  App.__foodDefaultConfidenceInstalled = true;

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const validConfidence = value => ['high', 'medium', 'low'].includes(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : '';
  const confidenceFor = food => validConfidence(food?.defaultConfidence ?? food?.confidence ?? '');

  // Add the saved default to both Add Food and Edit Food. This callback runs
  // after the inline food-editor enhancements and the default-meal-tag setup.
  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    await originalOpenFoodEditor.call(this, id);
    if (document.getElementById('foodEditDefaultConfidence')) return;

    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    const selected = confidenceFor(food);
    const defaultTagSelect = document.getElementById('foodEditDefaultMealTag');
    const pinnedLabel = document.getElementById('foodEditPinned')?.closest('label');
    const anchor = defaultTagSelect?.closest('label') || pinnedLabel;
    if (!anchor) return;

    const label = document.createElement('label');
    label.innerHTML = `Confidence level <span class="field-help">Default confidence when this food is logged</span><select id="foodEditDefaultConfidence"><option value="" ${selected ? '' : 'selected'}>Not specified</option><option value="high" ${selected === 'high' ? 'selected' : ''}>High</option><option value="medium" ${selected === 'medium' ? 'selected' : ''}>Medium</option><option value="low" ${selected === 'low' ? 'selected' : ''}>Low</option></select>`;
    anchor.insertAdjacentElement('afterend', label);
  };

  const originalCollectFoodForm = App.collectFoodForm;
  App.collectFoodForm = function(id) {
    const payload = originalCollectFoodForm.call(this, id);
    payload.defaultConfidence = validConfidence(
      document.getElementById('foodEditDefaultConfidence')?.value
      ?? confidenceFor(payload.existing)
    );
    return payload;
  };

  // Preserve the field through every existing food-save wrapper and the later
  // inline persistence override by enforcing it on the final foods write.
  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const db = this.db;
    const originalPut = db.put;
    const existing = payload?.existing || null;
    const defaultConfidence = validConfidence(
      payload?.defaultConfidence ?? confidenceFor(existing)
    );

    db.put = function(storeName, value) {
      if (storeName === 'foods' && value) {
        value = { ...value, defaultConfidence };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalPersistFoodForm.call(this, payload);
    } finally {
      db.put = originalPut;
    }
  };

  // Preselect the food's saved confidence in the normal logging modal. The
  // user can still change it to any other value, including Not specified.
  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const select = document.getElementById('savedConfidence');
    if (select && food) select.value = confidenceFor(food);
    return result;
  };

  // Quick Log can bypass the modal. Supply the food default only when the
  // caller did not already provide a confidence value explicitly.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = function(food, options = {}) {
    const nextOptions = { ...options };
    if (!hasOwn(options, 'confidence')) {
      nextOptions.confidence = confidenceFor(food);
    }
    return originalLogSavedFood.call(this, food, nextOptions);
  };
}, 0);
