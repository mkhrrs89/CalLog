(() => {
  if (App.__savedFoodDefaultTagAuthorityInstalled) return;
  App.__savedFoodDefaultTagAuthorityInstalled = true;

  const validDefaultTagId = food => {
    const id = food?.defaultMealTagId || '';
    return App.cache.tags.some(tag => tag.id === id) ? id : '';
  };

  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const select = document.getElementById('savedMealTag');
    if (!select) return;

    select.value = validDefaultTagId(food);
    select.dataset.userSelected = 'false';
    if (select.dataset.defaultTagTrackingInstalled !== 'true') {
      select.dataset.defaultTagTrackingInstalled = 'true';
      select.addEventListener('change', () => {
        select.dataset.userSelected = 'true';
      });
    }
  };

  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    const explicitlySelected = options.__mealTagSelectionExplicit === true;
    const requestedTagId = options.mealTagId || '';
    const mealTagId = explicitlySelected
      ? requestedTagId
      : (requestedTagId || validDefaultTagId(food));
    const cleanOptions = { ...options, mealTagId };
    delete cleanOptions.__mealTagSelectionExplicit;

    const previousExplicitState = this.__savedFoodTagWasExplicit;
    this.__savedFoodTagWasExplicit = explicitlySelected && !mealTagId;
    try {
      return await originalLogSavedFood.call(this, food, cleanOptions);
    } finally {
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

    await this.logSavedFood(food, {
      calories: Math.round(portion.calories * multiplier),
      multiplier,
      portionName: portion.name,
      mealTagId: tagSelect?.value || '',
      __mealTagSelectionExplicit: tagSelect?.dataset.userSelected === 'true',
      confidence: document.getElementById('savedConfidence')?.value || '',
      note: document.getElementById('savedNote')?.value.trim() || '',
    });
  };
})();
