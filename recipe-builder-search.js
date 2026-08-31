(() => {
  'use strict';

  if (!window.App || App.__recipeBuilderSearchInstalled) return;
  App.__recipeBuilderSearchInstalled = true;

  const regularFoods = () => [...(App.cache?.foods || [])]
    .filter(food => !food.recipe)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const ingredientById = ingredientId => App.recipeDraft?.ingredients?.find(item => item.id === ingredientId) || null;

  const foodNameForIngredient = ingredient => {
    if (!ingredient) return '';
    return App.cache.foods.find(food => food.id === ingredient.foodId)?.name
      || ingredient.foodNameSnapshot
      || '';
  };

  const searchableText = food => [
    food.name,
    food.source,
    food.folder,
    ...(food.aliases || []),
    ...(food.tags || []),
  ].map(value => App.normalizeName(value)).filter(Boolean).join(' ');

  const matchingFoods = query => {
    const normalized = App.normalizeName(query);
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
        const aliases = (food.aliases || []).map(alias => App.normalizeName(alias));
        const haystack = searchableText(food);
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

  const closeResults = except => {
    document.querySelectorAll('.recipe-food-search-results').forEach(results => {
      if (results !== except) results.hidden = true;
    });
  };

  const renderResults = (results, input, ingredientId) => {
    const foods = matchingFoods(input.value);
    results.innerHTML = foods.length
      ? foods.map(food => `
          <button class="recipe-food-search-result" type="button" data-food-id="${App.attr(food.id)}">
            <span class="recipe-food-search-result-name">${App.esc(food.name)}</span>
            <span class="recipe-food-search-result-calories">${App.formatNumber(food.calories)} cal</span>
          </button>`).join('')
      : '<div class="recipe-food-search-empty">No matching saved foods</div>';
    results.hidden = false;

    results.querySelectorAll('.recipe-food-search-result').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const foodId = button.dataset.foodId || '';
        if (!foodId) return;
        App.changeRecipeIngredientFood(ingredientId, foodId);
      });
    });
  };

  const enhanceIngredientSearch = label => {
    if (!label || label.dataset.searchPickerReady === 'true') return;
    const row = label.closest('.recipe-ingredient-row');
    const ingredientId = row?.dataset.ingredientId || '';
    const select = label.querySelector('select');
    const ingredient = ingredientById(ingredientId);
    if (!ingredientId || !select || !ingredient) return;

    label.dataset.searchPickerReady = 'true';
    const search = document.createElement('div');
    search.className = 'recipe-food-search';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'recipe-food-search-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Type to search saved foods…';
    input.value = foodNameForIngredient(ingredient);
    input.setAttribute('aria-label', 'Search saved foods');
    input.setAttribute('aria-autocomplete', 'list');

    const results = document.createElement('div');
    results.className = 'recipe-food-search-results';
    results.hidden = true;
    results.setAttribute('role', 'listbox');

    search.append(input, results);
    select.replaceWith(search);

    input.addEventListener('focus', () => {
      closeResults(results);
      input.select();
      renderResults(results, input, ingredientId);
    });

    input.addEventListener('input', () => {
      renderResults(results, input, ingredientId);
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        results.hidden = true;
        input.blur();
        return;
      }

      if (event.key === 'ArrowDown') {
        const first = results.querySelector('.recipe-food-search-result');
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === 'Enter' && !results.hidden) {
        const first = results.querySelector('.recipe-food-search-result');
        if (first) {
          event.preventDefault();
          first.click();
        }
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!search.contains(document.activeElement)) {
          results.hidden = true;
          const current = ingredientById(ingredientId);
          if (current) input.value = foodNameForIngredient(current);
        }
      }, 120);
    });

    results.addEventListener('keydown', event => {
      const buttons = [...results.querySelectorAll('.recipe-food-search-result')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' && buttons.length) {
        event.preventDefault();
        buttons[Math.min(buttons.length - 1, index + 1)]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (index <= 0) input.focus();
        else buttons[index - 1]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        results.hidden = true;
        input.focus();
      }
    });
  };

  const enhanceAllIngredientSearches = () => {
    document.querySelectorAll('.recipe-food-select').forEach(enhanceIngredientSearch);
  };

  if (typeof App.renderRecipeIngredientRows === 'function') {
    const originalRenderRecipeIngredientRows = App.renderRecipeIngredientRows;
    App.renderRecipeIngredientRows = function(...args) {
      const result = originalRenderRecipeIngredientRows.apply(this, args);
      enhanceAllIngredientSearches();
      return result;
    };
  }

  const modalContent = document.getElementById('modalContent');
  if (modalContent) {
    new MutationObserver(enhanceAllIngredientSearches).observe(modalContent, { childList: true, subtree: true });
  }

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.recipe-food-search')) closeResults();
  }, { passive: true });
})();
