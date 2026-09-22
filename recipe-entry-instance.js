setTimeout(() => {
  'use strict';

  if (!window.App || App.__recipeEntryInstanceInstalled) return;
  App.__recipeEntryInstanceInstalled = true;

  const safeNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const clone = value => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  const regularFoods = () => [...(App.cache?.foods || [])]
    .filter(food => !food.recipe)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const recipeFoodForEntry = entry => {
    if (!entry?.foodId) return null;
    const food = App.cache.foods.find(item => item.id === entry.foodId);
    return food?.recipe ? food : null;
  };

  const ingredientBaseCalories = ingredient => Math.max(0, safeNumber(
    ingredient?.caloriesPerUnitSnapshot,
    ingredient?.caloriesPerUnit || 0
  ));

  const ingredientSubtotal = ingredient => (
    ingredientBaseCalories(ingredient) * Math.max(0, safeNumber(ingredient?.quantity, 0))
  );

  const sourceRecipeTotal = food => {
    const recipe = food?.recipe;
    if (!recipe) return 0;
    const stored = safeNumber(recipe.totalCalories, NaN);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return (recipe.ingredients || []).reduce((sum, ingredient) => (
      sum + ingredientBaseCalories(ingredient) * Math.max(0, safeNumber(ingredient.quantity, 0))
    ), 0);
  };

  const makeInstance = (food, loggedCalories) => {
    if (!food?.recipe) return null;

    const fullTotal = sourceRecipeTotal(food);
    const servings = Math.max(0.01, safeNumber(food.recipe.servings, 1));
    const calories = Math.max(0, safeNumber(loggedCalories, food.calories));
    const scale = fullTotal > 0
      ? calories / fullTotal
      : 1 / servings;

    return {
      version: 1,
      recipeFoodId: food.id,
      recipeNameSnapshot: String(food.name || 'Recipe'),
      recipeUpdatedAt: food.recipe.updatedAt || food.updatedAt || '',
      sourceRecipeServings: servings,
      scaleFactor: scale,
      customized: false,
      totalCalories: Math.round(calories),
      ingredients: (food.recipe.ingredients || []).map(item => {
        const base = ingredientBaseCalories(item);
        const quantity = Math.max(0, safeNumber(item.quantity, 0)) * scale;
        return {
          id: item.id || App.uid('recipeEntryIngredient'),
          foodId: item.foodId || '',
          foodNameSnapshot: item.foodNameSnapshot || item.foodName || 'Missing food',
          portionId: item.portionId || 'default',
          portionNameSnapshot: item.portionNameSnapshot || item.portionName || 'Default serving',
          caloriesPerUnitSnapshot: base,
          quantity,
          subtotalCalories: Math.round(base * quantity),
        };
      }),
      createdAt: new Date().toISOString(),
    };
  };

  const instanceForEntry = entry => {
    if (entry?.recipeInstance?.ingredients?.length) return clone(entry.recipeInstance);
    const food = recipeFoodForEntry(entry);
    return food ? makeInstance(food, entry.calories) : null;
  };

  const matchingFoods = query => {
    const normalized = App.normalizeName(query || '');
    const foods = regularFoods();
    if (!normalized) {
      return foods
        .sort((a, b) => (b.useCount || 0) - (a.useCount || 0)
          || new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0)
          || String(a.name || '').localeCompare(String(b.name || '')))
        .slice(0, 10);
    }

    const terms = normalized.split(' ').filter(Boolean);
    return foods
      .map(food => {
        const name = App.normalizeName(food.name);
        const aliases = (food.aliases || []).map(value => App.normalizeName(value));
        const haystack = [
          food.name,
          food.source,
          food.folder,
          ...(food.aliases || []),
          ...(food.tags || []),
        ].map(value => App.normalizeName(value)).join(' ');
        let score = 0;
        if (name === normalized) score += 1200;
        if (aliases.includes(normalized)) score += 1050;
        if (name.startsWith(normalized)) score += 800;
        if (name.includes(normalized)) score += 620;
        if (terms.every(term => haystack.includes(term))) score += 380;
        if (food.pinned) score += 50;
        score += Math.min(90, (food.useCount || 0) * 3);
        return { food, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.food.name || '').localeCompare(String(b.food.name || '')))
      .slice(0, 10)
      .map(item => item.food);
  };

  const draftIngredient = id => App.recipeEntryDraft?.ingredients?.find(item => item.id === id) || null;

  const portionOptionsHtml = ingredient => {
    const food = App.cache.foods.find(item => item.id === ingredient.foodId && !item.recipe);
    if (!food) {
      return `<option value="${App.attr(ingredient.portionId || 'default')}" selected>${App.esc(ingredient.portionNameSnapshot || 'Saved serving')} — ${App.formatNumber(ingredientBaseCalories(ingredient))} cal</option>`;
    }

    const currentIds = new Set(['default', ...(food.portions || []).map(portion => portion.id)]);
    const missingSavedPortion = ingredient.portionId
      && !currentIds.has(ingredient.portionId);

    return [
      `<option value="default" ${!ingredient.portionId || ingredient.portionId === 'default' ? 'selected' : ''}>${App.esc(food.servingLabel || 'Default serving')} — ${App.formatNumber(food.calories)} cal</option>`,
      missingSavedPortion
        ? `<option value="${App.attr(ingredient.portionId)}" selected>${App.esc(ingredient.portionNameSnapshot || 'Logged serving')} — ${App.formatNumber(ingredientBaseCalories(ingredient))} cal (logged)</option>`
        : '',
      ...(food.portions || []).map(portion => `
        <option value="${App.attr(portion.id)}" ${portion.id === ingredient.portionId ? 'selected' : ''}>
          ${App.esc(portion.name)} — ${App.formatNumber(portion.calories)} cal
        </option>`),
    ].join('');
  };

  const closeFoodResults = except => {
    document.querySelectorAll('.recipe-entry-food-results').forEach(results => {
      if (results !== except) results.hidden = true;
    });
  };

  // Snapshot the ingredient breakdown on every newly logged recipe entry.
  const originalLogSavedFood = App.logSavedFood;
  App.logSavedFood = async function(food, options = {}) {
    if (!food?.recipe) return originalLogSavedFood.call(this, food, options);

    const db = this.db;
    const originalPut = db.put;
    db.put = function(storeName, value) {
      if (storeName === 'entries' && value?.foodId === food.id && !value.recipeInstance) {
        value = {
          ...value,
          recipeInstance: makeInstance(food, value.calories),
        };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalLogSavedFood.call(this, food, options);
    } finally {
      db.put = originalPut;
    }
  };

  // Keep the normal entry editor, but add a recipe-specific instance editor.
  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(id) {
    const result = originalOpenEntryEditor.call(this, id);
    const entry = this.cache.entries.find(item => item.id === id);
    const instance = instanceForEntry(entry);
    if (!entry || !instance) return result;

    const form = document.querySelector('#modalContent form');
    const actions = form?.querySelector('.actions:last-of-type');
    if (!form || !actions || form.querySelector('.recipe-entry-instance-card')) return result;

    const total = Math.round((instance.ingredients || []).reduce(
      (sum, ingredient) => sum + ingredientSubtotal(ingredient),
      0
    ));
    const card = document.createElement('div');
    card.className = 'card subtle recipe-entry-instance-card';
    card.innerHTML = `
      <div class="row space">
        <div>
          <h3 style="margin-bottom:.18rem">Recipe ingredients</h3>
          <div class="tiny muted">${instance.ingredients.length} ingredient${instance.ingredients.length === 1 ? '' : 's'} · ${this.formatNumber(total)} cal${instance.customized ? ' · customized for this log' : ''}</div>
        </div>
        <span class="recipe-entry-badge">This log only</span>
      </div>
      <button class="btn ghost block" type="button" style="margin-top:.7rem" onclick="App.openRecipeEntryIngredientEditor('${this.attr(entry.id)}')">Edit ingredients for this log</button>
    `;
    form.insertBefore(card, actions);
    return result;
  };

  App.openRecipeEntryIngredientEditor = function(entryId) {
    const entry = this.cache.entries.find(item => item.id === entryId);
    const instance = instanceForEntry(entry);
    if (!entry || !instance) return this.showToast('Recipe ingredients are not available for this entry');

    this.recipeEntryDraft = {
      entryId,
      recipeFoodId: instance.recipeFoodId || entry.foodId || '',
      recipeNameSnapshot: instance.recipeNameSnapshot || entry.name || 'Recipe',
      recipeUpdatedAt: instance.recipeUpdatedAt || '',
      sourceRecipeServings: safeNumber(instance.sourceRecipeServings, 1),
      scaleFactor: safeNumber(instance.scaleFactor, 1),
      ingredients: (instance.ingredients || []).map(item => ({
        ...clone(item),
        id: item.id || this.uid('recipeEntryIngredient'),
        quantity: Math.max(0, safeNumber(item.quantity, 0)),
        caloriesPerUnitSnapshot: ingredientBaseCalories(item),
      })),
    };

    this.showModal(`
      <div class="row space recipe-entry-title">
        <div>
          <div class="eyebrow">Logged recipe · this instance only</div>
          <h2>Edit ingredients</h2>
          <div class="small muted">${this.esc(entry.name || instance.recipeNameSnapshot || 'Recipe')}</div>
        </div>
        <button class="icon-btn" type="button" onclick="App.openEntryEditor('${this.attr(entryId)}')" aria-label="Back to entry">←</button>
      </div>
      <form class="form-grid recipe-entry-instance-form" onsubmit="event.preventDefault();App.saveRecipeEntryIngredients()">
        <div class="field-help">These changes affect only this logged occurrence. Your saved recipe in Foods will not be changed.</div>
        <div class="row space recipe-entry-heading">
          <h3 style="margin:0">Ingredients</h3>
          <button class="btn ghost small-btn" type="button" onclick="App.addRecipeEntryIngredient()">Add ingredient</button>
        </div>
        <div id="recipeEntryIngredientRows" class="recipe-entry-ingredient-list"></div>
        <div id="recipeEntrySummary" class="card subtle recipe-entry-summary"></div>
        <div class="actions">
          <button class="btn primary" type="submit">Save this log</button>
          <button class="btn ghost" type="button" onclick="App.openEntryEditor('${this.attr(entryId)}')">Cancel</button>
        </div>
      </form>
    `);
    this.renderRecipeEntryIngredientRows();
  };

  App.renderRecipeEntryIngredientRows = function() {
    const container = document.getElementById('recipeEntryIngredientRows');
    if (!container || !this.recipeEntryDraft) return;

    const ingredients = this.recipeEntryDraft.ingredients || [];
    container.innerHTML = ingredients.length
      ? ingredients.map((ingredient, index) => {
          const food = this.cache.foods.find(item => item.id === ingredient.foodId && !item.recipe);
          const foodName = food?.name || ingredient.foodNameSnapshot || '';
          return `
            <div class="recipe-entry-ingredient-row" data-recipe-entry-ingredient="${this.attr(ingredient.id)}">
              <div class="recipe-ingredient-number" aria-hidden="true">${index + 1}</div>
              <label class="recipe-entry-food-field">Saved food
                <div class="recipe-food-search">
                  <input
                    type="search"
                    class="recipe-food-search-input recipe-entry-food-input"
                    value="${this.attr(foodName)}"
                    placeholder="Type to search saved foods…"
                    autocomplete="off"
                    spellcheck="false"
                    onfocus="App.updateRecipeEntryFoodSearch('${this.attr(ingredient.id)}',this)"
                    oninput="App.updateRecipeEntryFoodSearch('${this.attr(ingredient.id)}',this)"
                  />
                  <div class="recipe-food-search-results recipe-entry-food-results" hidden></div>
                </div>
              </label>
              <label class="recipe-entry-portion-field">Serving / portion
                <select onchange="App.changeRecipeEntryIngredientPortion('${this.attr(ingredient.id)}',this.value)" ${ingredient.foodId ? '' : 'disabled'}>
                  ${portionOptionsHtml(ingredient)}
                </select>
              </label>
              <label class="recipe-entry-quantity-field">Amount
                <input type="number" min="0.01" step="any" inputmode="decimal" value="${this.attr(ingredient.quantity)}" oninput="App.changeRecipeEntryIngredientQuantity('${this.attr(ingredient.id)}',this.value)" />
              </label>
              <div class="recipe-ingredient-subtotal">
                <span class="tiny muted">Subtotal</span>
                <strong data-recipe-entry-subtotal="${this.attr(ingredient.id)}">${this.formatNumber(ingredientSubtotal(ingredient))} cal</strong>
              </div>
              <button class="icon-btn recipe-remove-ingredient" type="button" onclick="App.removeRecipeEntryIngredient('${this.attr(ingredient.id)}')" aria-label="Remove ingredient">×</button>
            </div>
          `;
        }).join('')
      : '<div class="empty-state">Add an ingredient to this logged recipe.</div>';

    this.updateRecipeEntrySummary();
  };

  App.updateRecipeEntryFoodSearch = function(ingredientId, input) {
    const row = input?.closest('.recipe-entry-ingredient-row');
    const results = row?.querySelector('.recipe-entry-food-results');
    if (!results) return;

    closeFoodResults(results);
    const foods = matchingFoods(input.value);
    results.innerHTML = foods.length
      ? foods.map(food => `
          <button class="recipe-food-search-result" type="button" onclick="App.selectRecipeEntryFood('${this.attr(ingredientId)}','${this.attr(food.id)}')">
            <span class="recipe-food-search-result-name">${this.esc(food.name)}</span>
            <span class="recipe-food-search-result-calories">${this.formatNumber(food.calories)} cal</span>
          </button>`).join('')
      : '<div class="recipe-food-search-empty">No matching saved foods</div>';
    results.hidden = false;
  };

  App.selectRecipeEntryFood = function(ingredientId, foodId) {
    const ingredient = draftIngredient(ingredientId);
    const food = this.cache.foods.find(item => item.id === foodId && !item.recipe);
    if (!ingredient || !food) return;

    ingredient.foodId = food.id;
    ingredient.foodNameSnapshot = food.name;
    ingredient.portionId = 'default';
    ingredient.portionNameSnapshot = food.servingLabel || 'Default serving';
    ingredient.caloriesPerUnitSnapshot = Math.max(0, safeNumber(food.calories));
    this.renderRecipeEntryIngredientRows();
  };

  App.changeRecipeEntryIngredientPortion = function(ingredientId, portionId) {
    const ingredient = draftIngredient(ingredientId);
    if (!ingredient) return;
    const food = this.cache.foods.find(item => item.id === ingredient.foodId && !item.recipe);
    if (!food) return;

    const portion = portionId === 'default'
      ? null
      : (food.portions || []).find(item => item.id === portionId);

    ingredient.portionId = portionId || 'default';
    ingredient.foodNameSnapshot = food.name;
    ingredient.portionNameSnapshot = portion?.name || food.servingLabel || 'Default serving';
    ingredient.caloriesPerUnitSnapshot = Math.max(0, safeNumber(portion?.calories, food.calories));
    this.renderRecipeEntryIngredientRows();
  };

  App.changeRecipeEntryIngredientQuantity = function(ingredientId, value) {
    const ingredient = draftIngredient(ingredientId);
    if (!ingredient) return;
    ingredient.quantity = Math.max(0, safeNumber(value, 0));
    const subtotal = document.querySelector(`[data-recipe-entry-subtotal="${CSS.escape(ingredientId)}"]`);
    if (subtotal) subtotal.textContent = `${this.formatNumber(ingredientSubtotal(ingredient))} cal`;
    this.updateRecipeEntrySummary();
  };

  App.addRecipeEntryIngredient = function() {
    if (!this.recipeEntryDraft) return;
    this.recipeEntryDraft.ingredients.push({
      id: this.uid('recipeEntryIngredient'),
      foodId: '',
      foodNameSnapshot: '',
      portionId: 'default',
      portionNameSnapshot: 'Default serving',
      caloriesPerUnitSnapshot: 0,
      quantity: 1,
      subtotalCalories: 0,
    });
    this.renderRecipeEntryIngredientRows();

    requestAnimationFrame(() => {
      const rows = document.querySelectorAll('.recipe-entry-ingredient-row');
      const input = rows[rows.length - 1]?.querySelector('.recipe-entry-food-input');
      input?.focus();
    });
  };

  App.removeRecipeEntryIngredient = function(ingredientId) {
    if (!this.recipeEntryDraft) return;
    this.recipeEntryDraft.ingredients = this.recipeEntryDraft.ingredients.filter(item => item.id !== ingredientId);
    this.renderRecipeEntryIngredientRows();
  };

  App.updateRecipeEntrySummary = function() {
    const target = document.getElementById('recipeEntrySummary');
    if (!target || !this.recipeEntryDraft) return;
    const total = Math.round((this.recipeEntryDraft.ingredients || []).reduce(
      (sum, ingredient) => sum + ingredientSubtotal(ingredient),
      0
    ));
    target.innerHTML = `
      <div class="recipe-summary-label">This logged recipe</div>
      <div class="row space">
        <span class="muted">Calculated calories</span>
        <strong class="recipe-entry-total">${this.formatNumber(total)} cal</strong>
      </div>
    `;
  };

  App.saveRecipeEntryIngredients = async function() {
    const draft = this.recipeEntryDraft;
    if (!draft) return;
    const entry = this.cache.entries.find(item => item.id === draft.entryId);
    if (!entry) return this.showToast('That log entry no longer exists');

    const ingredients = draft.ingredients || [];
    if (!ingredients.length) return this.showToast('Add at least one ingredient');

    const invalid = ingredients.find(item => (
      (!item.foodId && !item.foodNameSnapshot)
      || !(safeNumber(item.quantity, 0) > 0)
      || !Number.isFinite(Number(item.caloriesPerUnitSnapshot))
      || Number(item.caloriesPerUnitSnapshot) < 0
    ));
    if (invalid) return this.showToast('Choose a food, serving, and amount for every ingredient');

    const normalized = ingredients.map(item => {
      const quantity = Math.max(0, safeNumber(item.quantity, 0));
      const base = ingredientBaseCalories(item);
      return {
        ...clone(item),
        quantity,
        caloriesPerUnitSnapshot: base,
        subtotalCalories: Math.round(base * quantity),
      };
    });
    const total = Math.round(normalized.reduce((sum, ingredient) => sum + ingredientSubtotal(ingredient), 0));
    const multiplier = Math.max(0, safeNumber(entry.multiplier, 1));
    const now = new Date().toISOString();

    const updated = {
      ...entry,
      calories: total,
      portionCalories: multiplier > 0 ? total / multiplier : total,
      recipeInstance: {
        version: 1,
        recipeFoodId: draft.recipeFoodId || entry.foodId || '',
        recipeNameSnapshot: draft.recipeNameSnapshot || entry.name || 'Recipe',
        recipeUpdatedAt: draft.recipeUpdatedAt || '',
        sourceRecipeServings: draft.sourceRecipeServings,
        scaleFactor: draft.scaleFactor,
        customized: true,
        totalCalories: total,
        ingredients: normalized,
        createdAt: entry.recipeInstance?.createdAt || now,
        updatedAt: now,
      },
      updatedAt: now,
    };

    await this.db.put('entries', updated);
    this.recipeEntryDraft = null;
    this.closeModal();
    await this.refreshCache();
    this.view.bumpTotal = true;
    await this.render();
    this.showToast('Recipe ingredients updated for this log');
  };

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.recipe-entry-food-field')) closeFoodResults();
  }, { passive: true });
}, 0);
