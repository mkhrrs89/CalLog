(() => {
  'use strict';

  if (!window.App || App.__servingLabelInstalled) return;
  App.__servingLabelInstalled = true;

  const servingLabelFor = food => String(food?.servingLabel ?? '');

  // Normalize older foods and foods created through alternate flows so every
  // saved food record carries the new field, even when its value is blank.
  const originalRefreshCache = App.refreshCache;
  App.refreshCache = async function(...args) {
    const result = await originalRefreshCache.apply(this, args);
    const missing = this.cache.foods.filter(food => !Object.prototype.hasOwnProperty.call(food, 'servingLabel'));

    if (missing.length) {
      const normalized = missing.map(food => ({ ...food, servingLabel: '' }));
      await this.db.putMany('foods', normalized);
      const replacements = new Map(normalized.map(food => [food.id, food]));
      this.cache.foods = this.cache.foods.map(food => replacements.get(food.id) || food);
    }

    return result;
  };

  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    await originalOpenFoodEditor.call(this, id);
    if (document.getElementById('foodEditServingLabel')) return;

    const food = id ? this.cache.foods.find(item => item.id === id) : null;
    const caloriesInput = document.getElementById('foodEditCalories');
    const caloriesLabel = caloriesInput?.closest('label');
    if (!caloriesLabel) return;

    const label = document.createElement('label');
    label.innerHTML = `Serving label <span class="field-help">Optional; any text, such as tablespoon, cup, slice, or bowl</span><input id="foodEditServingLabel" value="${this.attr(servingLabelFor(food))}" placeholder="e.g. tablespoon" />`;
    caloriesLabel.insertAdjacentElement('afterend', label);
  };

  const originalCollectFoodForm = App.collectFoodForm;
  App.collectFoodForm = function(id) {
    const payload = originalCollectFoodForm.call(this, id);
    payload.servingLabel = document.getElementById('foodEditServingLabel')?.value ?? servingLabelFor(payload.existing);
    return payload;
  };

  // Preserve the original food-save pipeline and its revision handling while
  // attaching the new field to the food record it writes.
  const originalPersistFoodForm = App.persistFoodForm;
  App.persistFoodForm = async function(payload) {
    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'foods') {
        value = { ...value, servingLabel: String(payload.servingLabel ?? '') };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalPersistFoodForm.call(this, payload);
    } finally {
      db.put = originalPut;
    }
  };

  // Show the custom label as the default serving while logging a saved food.
  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const select = document.getElementById('savedPortion');
    const firstOption = select?.options?.[0];
    const label = servingLabelFor(food);

    if (firstOption && label) {
      firstOption.textContent = `${label} — ${this.formatNumber(food.calories)} cal`;
    }

    return result;
  };

  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = function(food, options = {}) {
    const nextOptions = { ...options };
    if (!nextOptions.portionName || nextOptions.portionName === 'Default') {
      nextOptions.portionName = servingLabelFor(food) || 'Default';
    }
    return originalLogSavedFood.call(this, food, nextOptions);
  };

  // Recipes are saved as food records too, so expose and persist the same
  // field in the recipe builder.
  if (typeof App.openRecipeBuilder === 'function') {
    const originalOpenRecipeBuilder = App.openRecipeBuilder;
    App.openRecipeBuilder = function(id = '') {
      const result = originalOpenRecipeBuilder.call(this, id);
      if (document.getElementById('recipeServingLabel')) return result;

      const recipeFood = id ? this.cache.foods.find(food => food.id === id && food.recipe) : null;
      const servingsInput = document.getElementById('recipeServings');
      const servingsLabel = servingsInput?.closest('label');
      if (!servingsLabel) return result;

      const label = document.createElement('label');
      label.innerHTML = `Serving label <span class="field-help">Optional; any text</span><input id="recipeServingLabel" value="${this.attr(servingLabelFor(recipeFood))}" placeholder="e.g. bowl" />`;
      servingsLabel.insertAdjacentElement('afterend', label);
      return result;
    };
  }

  if (typeof App.renderRecipeIngredientRows === 'function') {
    const originalRenderRecipeIngredientRows = App.renderRecipeIngredientRows;
    App.renderRecipeIngredientRows = function(...args) {
      const result = originalRenderRecipeIngredientRows.apply(this, args);

      for (const row of document.querySelectorAll('.recipe-ingredient-row')) {
        const ingredientId = row.dataset.ingredientId;
        const ingredient = this.recipeDraft?.ingredients?.find(item => item.id === ingredientId);
        const food = this.cache.foods.find(item => item.id === ingredient?.foodId);
        const option = row.querySelector('.recipe-portion-select select option[value="default"]');
        const label = servingLabelFor(food);
        if (option && food && label) {
          option.textContent = `${label} — ${this.formatNumber(food.calories)} cal`;
        }
      }

      return result;
    };
  }

  if (typeof App.saveRecipe === 'function') {
    const originalSaveRecipe = App.saveRecipe;
    App.saveRecipe = async function(...args) {
      const servingLabel = document.getElementById('recipeServingLabel')?.value ?? '';

      for (const ingredient of this.recipeDraft?.ingredients || []) {
        if (!ingredient.portionId || ingredient.portionId === 'default') {
          const food = this.cache.foods.find(item => item.id === ingredient.foodId);
          ingredient.portionNameSnapshot = servingLabelFor(food) || 'Default serving';
        }
      }

      const db = this.db;
      const originalPut = db.put;
      db.put = function(storeName, value) {
        if (storeName === 'foods' && value?.recipe) {
          value = { ...value, servingLabel: String(servingLabel) };
        }
        return originalPut.call(this, storeName, value);
      };

      try {
        return await originalSaveRecipe.apply(this, args);
      } finally {
        db.put = originalPut;
      }
    };
  }

  // Keep the existing CSV export and add the new field without removing any
  // existing columns.
  App.exportFoodsCsv = function() {
    const rows = [[
      'name',
      'default_calories',
      'serving_label',
      'pinned',
      'source',
      'folder',
      'tags',
      'aliases',
      'portions',
      'use_count',
      'last_used',
    ]];

    [...this.cache.foods].sort((a, b) => a.name.localeCompare(b.name)).forEach(food => {
      rows.push([
        food.name,
        food.calories,
        servingLabelFor(food),
        food.pinned ? 'yes' : 'no',
        food.source || '',
        food.folder || '',
        (food.tags || []).join('; '),
        (food.aliases || []).join('; '),
        (food.portions || []).map(portion => `${portion.name}:${portion.calories}`).join('; '),
        food.useCount || 0,
        food.lastUsedAt || '',
      ]);
    });

    this.downloadBlob(this.csvText(rows), `foodlog-foods-${this.today()}.csv`, 'text/csv;charset=utf-8');
    this.showToast('Foods CSV exported');
  };
})();
