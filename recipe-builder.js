(() => {
  'use strict';

  if (!window.App || App.__recipeBuilderInstalled) return;
  App.__recipeBuilderInstalled = true;

  const originalRenderFoods = App.renderFoods;
  const originalFoodRowHtml = App.foodRowHtml;

  const regularFoods = () => [...App.cache.foods]
    .filter(food => !food.recipe)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const existingRecipe = id => id
    ? App.cache.foods.find(food => food.id === id && food.recipe)
    : null;

  const safeNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const formatAmount = value => {
    const number = safeNumber(value);
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
  };

  const ingredientBaseCalories = ingredient => {
    const food = App.cache.foods.find(item => item.id === ingredient.foodId);
    if (!food) return safeNumber(ingredient.caloriesPerUnitSnapshot);
    if (ingredient.portionId && ingredient.portionId !== 'default') {
      const portion = (food.portions || []).find(item => item.id === ingredient.portionId);
      if (portion) return safeNumber(portion.calories);
    }
    return safeNumber(food.calories);
  };

  const ingredientFoodName = ingredient => {
    const food = App.cache.foods.find(item => item.id === ingredient.foodId);
    return food?.name || ingredient.foodNameSnapshot || 'Missing food';
  };

  const ingredientPortionName = ingredient => {
    const food = App.cache.foods.find(item => item.id === ingredient.foodId);
    if (food && ingredient.portionId && ingredient.portionId !== 'default') {
      const portion = (food.portions || []).find(item => item.id === ingredient.portionId);
      if (portion) return portion.name;
    }
    return ingredient.portionNameSnapshot || 'Default serving';
  };

  const ingredientSubtotal = ingredient => (
    ingredientBaseCalories(ingredient) * Math.max(0, safeNumber(ingredient.quantity, 0))
  );

  const recipeTotals = draft => {
    const total = (draft.ingredients || []).reduce(
      (sum, ingredient) => sum + ingredientSubtotal(ingredient),
      0
    );
    const servings = Math.max(0.01, safeNumber(draft.servings, 1));
    return {
      total,
      roundedTotal: Math.round(total),
      perServing: Math.round(total / servings),
    };
  };

  const foodOptionsHtml = ingredient => {
    const foods = regularFoods();
    const missingFood = ingredient.foodId
      && !foods.some(food => food.id === ingredient.foodId);

    return [
      '<option value="">Choose a saved food…</option>',
      missingFood
        ? `<option value="${App.attr(ingredient.foodId)}" selected>${App.esc(ingredient.foodNameSnapshot || 'Missing saved food')} (missing)</option>`
        : '',
      ...foods.map(food => `
        <option value="${App.attr(food.id)}" ${food.id === ingredient.foodId ? 'selected' : ''}>
          ${App.esc(food.name)} — ${App.formatNumber(food.calories)} cal
        </option>`),
    ].join('');
  };

  const portionOptionsHtml = ingredient => {
    const food = App.cache.foods.find(item => item.id === ingredient.foodId);
    if (!food) {
      return `
        <option value="${App.attr(ingredient.portionId || 'default')}" selected>
          ${App.esc(ingredient.portionNameSnapshot || 'Saved serving')} — ${App.formatNumber(ingredient.caloriesPerUnitSnapshot || 0)} cal
        </option>`;
    }

    return [
      `<option value="default" ${!ingredient.portionId || ingredient.portionId === 'default' ? 'selected' : ''}>
        Default serving — ${App.formatNumber(food.calories)} cal
      </option>`,
      ...(food.portions || []).map(portion => `
        <option value="${App.attr(portion.id)}" ${portion.id === ingredient.portionId ? 'selected' : ''}>
          ${App.esc(portion.name)} — ${App.formatNumber(portion.calories)} cal
        </option>`),
    ].join('');
  };

  App.renderFoods = async function(...args) {
    let html = await originalRenderFoods.apply(this, args);
    const addFoodButton = '<button class="btn primary" onclick="App.openFoodEditor()">Add food</button>';
    const enhancedButtons = `
      <button class="btn ghost" onclick="App.openRecipeBuilder()">Add recipe</button>
      ${addFoodButton}`;
    html = html.replace(addFoodButton, enhancedButtons);
    return html;
  };

  App.foodRowHtml = function(food) {
    if (!food?.recipe) return originalFoodRowHtml.call(this, food);

    const selected = this.view.selectedFoods.has(food.id);
    const ingredientCount = food.recipe.ingredients?.length || 0;
    const servings = safeNumber(food.recipe.servings, 1);
    const meta = `Recipe · ${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'} · ${formatAmount(servings)} serving${servings === 1 ? '' : 's'}`;

    return `
      <div class="food-row recipe-food-row">
        ${this.view.foodBulk
          ? `<input type="checkbox" ${selected ? 'checked' : ''} onchange="App.toggleFoodSelected('${food.id}',this.checked)" aria-label="Select ${this.attr(food.name)}" />`
          : `<span class="star">${food.pinned ? '★' : '◈'}</span>`}
        <button class="food-row-main" onclick="${this.view.foodBulk
          ? `App.toggleFoodSelected('${food.id}')`
          : `App.openRecipeBuilder('${food.id}')`}">
          <strong class="food-name">${this.esc(food.name)}</strong>
          <div class="food-row-meta">${this.esc(meta)}</div>
        </button>
        <strong>${this.formatNumber(food.calories)} cal</strong>
      </div>`;
  };

  App.openRecipeBuilder = function(id = '') {
    const recipeFood = existingRecipe(id);
    const foods = regularFoods();

    const storedIngredients = recipeFood?.recipe?.ingredients || [];
    const ingredients = storedIngredients.map(item => ({
      id: item.id || this.uid('recipeIngredient'),
      foodId: item.foodId || '',
      portionId: item.portionId || 'default',
      quantity: safeNumber(item.quantity, 1),
      foodNameSnapshot: item.foodNameSnapshot || item.foodName || '',
      portionNameSnapshot: item.portionNameSnapshot || item.portionName || 'Default serving',
      caloriesPerUnitSnapshot: safeNumber(item.caloriesPerUnitSnapshot, item.caloriesPerUnit || 0),
    }));

    if (!ingredients.length && foods.length) {
      const food = foods[0];
      ingredients.push({
        id: this.uid('recipeIngredient'),
        foodId: food.id,
        portionId: 'default',
        quantity: 1,
        foodNameSnapshot: food.name,
        portionNameSnapshot: 'Default serving',
        caloriesPerUnitSnapshot: safeNumber(food.calories),
      });
    }

    this.recipeDraft = {
      id: recipeFood?.id || '',
      name: recipeFood?.name || '',
      servings: safeNumber(recipeFood?.recipe?.servings, 1),
      pinned: !!recipeFood?.pinned,
      defaultMealTagId: recipeFood?.defaultMealTagId || '',
      ingredients,
    };

    this.showModal(`
      <div class="row space recipe-builder-title">
        <div>
          <div class="eyebrow">${recipeFood ? 'Saved recipe' : 'New recipe'}</div>
          <h2>${recipeFood ? 'Edit recipe' : 'Build recipe'}</h2>
        </div>
        <button class="icon-btn" type="button" onclick="App.closeModal()" aria-label="Close recipe builder">×</button>
      </div>

      ${foods.length || ingredients.length ? `
        <form class="form-grid recipe-builder-form" onsubmit="event.preventDefault();App.saveRecipe()">
          <div class="form-grid two">
            <label>Recipe name
              <input id="recipeName" value="${this.attr(this.recipeDraft.name)}" placeholder="e.g. Honey Dijon Chicken" required />
            </label>
            <label>Number of servings
              <input id="recipeServings" type="number" min="0.25" step="0.25" inputmode="decimal" value="${this.attr(this.recipeDraft.servings)}" oninput="App.updateRecipeServings(this.value)" required />
            </label>
          </div>

          <div class="form-grid two">
            <label>Default meal tag
              <select id="recipeDefaultMealTag">
                <option value="">No default meal tag</option>
                ${this.cache.tags.map(tag => `<option value="${this.attr(tag.id)}" ${tag.id === this.recipeDraft.defaultMealTagId ? 'selected' : ''}>${this.esc(tag.name)}</option>`).join('')}
              </select>
            </label>
            <label class="checkbox-line recipe-pin-line">
              <input id="recipePinned" type="checkbox" ${this.recipeDraft.pinned ? 'checked' : ''} />
              Pin recipe on Today screen
            </label>
          </div>

          <div class="row space recipe-ingredients-heading">
            <div>
              <h3>Ingredients</h3>
              <div class="field-help">Each ingredient uses one of your existing saved foods and portions.</div>
            </div>
            <button class="btn ghost small-btn" type="button" onclick="App.addRecipeIngredient()">Add ingredient</button>
          </div>

          <div id="recipeIngredientRows" class="recipe-ingredient-list"></div>
          <div id="recipeSummary" class="recipe-summary card subtle"></div>

          <div class="actions recipe-builder-actions">
            <button class="btn primary" type="submit">${recipeFood ? 'Save changes' : 'Save recipe'}</button>
            <button class="btn ghost" type="button" onclick="App.closeModal()">Cancel</button>
          </div>
        </form>` : `
        <div class="empty-state">
          <strong>Add at least one saved food first.</strong><br />
          Recipes are built from foods already in your library.
        </div>
        <div class="actions" style="margin-top:.8rem">
          <button class="btn primary" type="button" onclick="App.closeModal();App.openFoodEditor()">Add a food</button>
          <button class="btn ghost" type="button" onclick="App.closeModal()">Close</button>
        </div>`}
    `);

    requestAnimationFrame(() => this.renderRecipeIngredientRows());
  };

  App.renderRecipeIngredientRows = function() {
    const container = document.getElementById('recipeIngredientRows');
    if (!container || !this.recipeDraft) return;

    const ingredients = this.recipeDraft.ingredients || [];
    container.innerHTML = ingredients.length
      ? ingredients.map((ingredient, index) => `
          <div class="recipe-ingredient-row" data-ingredient-id="${this.attr(ingredient.id)}">
            <div class="recipe-ingredient-number" aria-hidden="true">${index + 1}</div>
            <label class="recipe-food-select">Saved food
              <select onchange="App.changeRecipeIngredientFood('${this.attr(ingredient.id)}',this.value)">
                ${foodOptionsHtml(ingredient)}
              </select>
            </label>
            <label class="recipe-portion-select">Serving / portion
              <select onchange="App.changeRecipeIngredientPortion('${this.attr(ingredient.id)}',this.value)" ${ingredient.foodId ? '' : 'disabled'}>
                ${portionOptionsHtml(ingredient)}
              </select>
            </label>
            <label class="recipe-quantity-input">Amount
              <input type="number" min="0.01" step="0.25" inputmode="decimal" value="${this.attr(ingredient.quantity)}" oninput="App.changeRecipeIngredientQuantity('${this.attr(ingredient.id)}',this.value)" />
            </label>
            <div class="recipe-ingredient-subtotal">
              <span class="tiny muted">Subtotal</span>
              <strong data-recipe-subtotal="${this.attr(ingredient.id)}">${this.formatNumber(ingredientSubtotal(ingredient))} cal</strong>
            </div>
            <button class="icon-btn recipe-remove-ingredient" type="button" onclick="App.removeRecipeIngredient('${this.attr(ingredient.id)}')" aria-label="Remove ${this.attr(ingredientFoodName(ingredient))}">×</button>
          </div>`).join('')
      : '<div class="empty-state">Add an ingredient to begin building the recipe.</div>';

    this.updateRecipeSummary();
  };

  App.addRecipeIngredient = function() {
    if (!this.recipeDraft) return;
    const foods = regularFoods();
    if (!foods.length) return this.showToast('Add a saved food first');
    const food = foods[0];
    this.recipeDraft.ingredients.push({
      id: this.uid('recipeIngredient'),
      foodId: food.id,
      portionId: 'default',
      quantity: 1,
      foodNameSnapshot: food.name,
      portionNameSnapshot: 'Default serving',
      caloriesPerUnitSnapshot: safeNumber(food.calories),
    });
    this.renderRecipeIngredientRows();
  };

  App.removeRecipeIngredient = function(ingredientId) {
    if (!this.recipeDraft) return;
    this.recipeDraft.ingredients = this.recipeDraft.ingredients.filter(item => item.id !== ingredientId);
    this.renderRecipeIngredientRows();
  };

  App.changeRecipeIngredientFood = function(ingredientId, foodId) {
    const ingredient = this.recipeDraft?.ingredients.find(item => item.id === ingredientId);
    if (!ingredient) return;
    const food = this.cache.foods.find(item => item.id === foodId && !item.recipe);
    ingredient.foodId = foodId;
    ingredient.portionId = 'default';
    ingredient.foodNameSnapshot = food?.name || ingredient.foodNameSnapshot || '';
    ingredient.portionNameSnapshot = 'Default serving';
    ingredient.caloriesPerUnitSnapshot = safeNumber(food?.calories, ingredient.caloriesPerUnitSnapshot);
    this.renderRecipeIngredientRows();
  };

  App.changeRecipeIngredientPortion = function(ingredientId, portionId) {
    const ingredient = this.recipeDraft?.ingredients.find(item => item.id === ingredientId);
    if (!ingredient) return;
    const food = this.cache.foods.find(item => item.id === ingredient.foodId);
    const portion = portionId === 'default'
      ? null
      : (food?.portions || []).find(item => item.id === portionId);
    ingredient.portionId = portionId || 'default';
    ingredient.foodNameSnapshot = food?.name || ingredient.foodNameSnapshot;
    ingredient.portionNameSnapshot = portion?.name || 'Default serving';
    ingredient.caloriesPerUnitSnapshot = safeNumber(portion?.calories, food?.calories || ingredient.caloriesPerUnitSnapshot);
    this.renderRecipeIngredientRows();
  };

  App.changeRecipeIngredientQuantity = function(ingredientId, value) {
    const ingredient = this.recipeDraft?.ingredients.find(item => item.id === ingredientId);
    if (!ingredient) return;
    ingredient.quantity = Math.max(0, safeNumber(value, 0));
    const subtotal = document.querySelector(`[data-recipe-subtotal="${CSS.escape(ingredientId)}"]`);
    if (subtotal) subtotal.textContent = `${this.formatNumber(ingredientSubtotal(ingredient))} cal`;
    this.updateRecipeSummary();
  };

  App.updateRecipeServings = function(value) {
    if (!this.recipeDraft) return;
    this.recipeDraft.servings = Math.max(0, safeNumber(value, 0));
    this.updateRecipeSummary();
  };

  App.updateRecipeSummary = function() {
    const summary = document.getElementById('recipeSummary');
    if (!summary || !this.recipeDraft) return;
    const totals = recipeTotals(this.recipeDraft);
    const servings = safeNumber(this.recipeDraft.servings, 0);
    summary.innerHTML = `
      <div class="recipe-summary-label">Recipe calories</div>
      <div class="recipe-summary-values">
        <div><span>Full recipe</span><strong>${this.formatNumber(totals.roundedTotal)} cal</strong></div>
        <div><span>Per serving</span><strong>${servings > 0 ? this.formatNumber(totals.perServing) : '—'} cal</strong></div>
      </div>
      <div class="field-help">The saved food’s default calories will be one serving. “Full recipe” will also be available as a portion.</div>`;
  };

  App.saveRecipe = async function() {
    if (!this.recipeDraft) return;

    const name = document.getElementById('recipeName')?.value.trim() || '';
    const servings = safeNumber(document.getElementById('recipeServings')?.value, 0);
    const pinned = !!document.getElementById('recipePinned')?.checked;
    const defaultMealTagId = document.getElementById('recipeDefaultMealTag')?.value || '';
    const ingredients = this.recipeDraft.ingredients || [];

    if (!name) return this.showToast('Recipe name is required');
    if (!(servings > 0)) return this.showToast('Enter a serving count greater than 0');
    if (!ingredients.length) return this.showToast('Add at least one ingredient');

    const invalidIngredient = ingredients.find(item => !item.foodId || !(safeNumber(item.quantity, 0) > 0));
    if (invalidIngredient) return this.showToast('Choose a food and amount for every ingredient');

    const existing = existingRecipe(this.recipeDraft.id);
    const duplicate = this.cache.foods.find(food =>
      food.id !== existing?.id && this.normalizeName(food.name) === this.normalizeName(name)
    );
    if (duplicate) return this.showToast('A saved food with that name already exists');

    const totals = recipeTotals({ ...this.recipeDraft, servings, ingredients });
    const now = new Date().toISOString();
    const foodId = existing?.id || this.uid('food');

    if (existing) {
      await this.db.put('revisions', {
        id: this.uid('revision'),
        entityId: existing.id,
        entityType: 'food',
        snapshot: structuredClone(existing),
        createdAt: now,
      });
    }

    const ingredientSnapshots = ingredients.map(ingredient => {
      const baseCalories = ingredientBaseCalories(ingredient);
      return {
        id: ingredient.id || this.uid('recipeIngredient'),
        foodId: ingredient.foodId,
        foodNameSnapshot: ingredientFoodName(ingredient),
        portionId: ingredient.portionId || 'default',
        portionNameSnapshot: ingredientPortionName(ingredient),
        caloriesPerUnitSnapshot: baseCalories,
        quantity: safeNumber(ingredient.quantity, 1),
        subtotalCalories: Math.round(baseCalories * safeNumber(ingredient.quantity, 1)),
      };
    });

    const preservedPortions = (existing?.portions || []).filter(portion => !portion.recipeGenerated);
    const fullRecipePortion = {
      id: existing?.portions?.find(portion => portion.recipeGenerated)?.id || this.uid('portion'),
      name: `Full recipe (${formatAmount(servings)} serving${servings === 1 ? '' : 's'})`,
      calories: totals.roundedTotal,
      recipeGenerated: true,
    };

    const record = {
      ...(existing || {}),
      id: foodId,
      name,
      nameLower: this.normalizeName(name),
      calories: totals.perServing,
      pinned,
      defaultMealTagId,
      source: existing?.source || 'Recipe',
      folder: existing?.folder || 'Recipes',
      tags: [...new Set([...(existing?.tags || []), 'Recipe'])],
      aliases: existing?.aliases || [],
      portions: [...preservedPortions, fullRecipePortion],
      useCount: existing?.useCount || 0,
      lastUsedAt: existing?.lastUsedAt || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      recipe: {
        version: 1,
        servings,
        totalCalories: totals.roundedTotal,
        caloriesPerServing: totals.perServing,
        ingredients: ingredientSnapshots,
        updatedAt: now,
      },
    };

    await this.db.put('foods', record);
    this.recipeDraft = null;
    this.closeModal();
    await this.refreshCache();
    await this.render();
    this.showToast(existing ? 'Recipe updated' : 'Recipe saved');
  };
})();
