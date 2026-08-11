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

  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    const explicitlySelected = options.__mealTagSelectionExplicit === true;
    const requestedTagId = resolveTagId(options.mealTagId);
    const mealTagId = explicitlySelected
      ? requestedTagId
      : (requestedTagId || defaultTagIdFor(food));

    const nextOptions = {
      ...options,
      mealTagId,
      __mealTagSelectionExplicit: explicitlySelected,
    };

    // Older logging wrappers use this flag to distinguish an intentional
    // "Untagged" selection from a missing/empty value. Set it only while the
    // underlying legacy chain runs so an explicit user choice remains valid.
    const previousExplicitState = this.__savedFoodTagWasExplicit;
    this.__savedFoodTagWasExplicit = explicitlySelected && !mealTagId;
    try {
      return await originalLogSavedFood.call(this, food, nextOptions);
    } finally {
      this.__savedFoodTagWasExplicit = previousExplicitState;
    }
  };

  // Make the modal submit path deterministic instead of relying on whichever
  // older wrapper happened to run last. If the user never touched Meal tag,
  // the food's saved default is authoritative even when that meal has no
  // entries yet today.
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

  // Quick Log may bypass the modal entirely. Passing the resolved default here
  // makes that route explicit and independent of whether a matching meal group
  // is already visible on the page.
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
