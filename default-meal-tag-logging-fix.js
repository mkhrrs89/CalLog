setTimeout(() => {
  if (App.__defaultMealTagLoggingFixInstalled) return;
  App.__defaultMealTagLoggingFixInstalled = true;

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
    select.addEventListener('change', () => {
      select.dataset.userSelected = 'true';
    });
  };

  const originalSubmitSavedFoodLog = App.submitSavedFoodLog;
  App.submitSavedFoodLog = async function(foodId) {
    const select = document.getElementById('savedMealTag');
    this.__savedFoodTagWasExplicit = select?.dataset.userSelected === 'true';
    try {
      await originalSubmitSavedFoodLog.call(this, foodId);
    } finally {
      this.__savedFoodTagWasExplicit = false;
    }
  };

  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = function(food, options = {}) {
    const hasTagOption = Object.prototype.hasOwnProperty.call(options, 'mealTagId');
    const explicitUntagged = hasTagOption && !options.mealTagId && this.__savedFoodTagWasExplicit === true;
    const mealTagId = explicitUntagged
      ? ''
      : (options.mealTagId || validDefaultTagId(food));

    return originalLogSavedFood.call(this, food, { ...options, mealTagId });
  };
}, 0);
