(() => {
  'use strict';

  if (!window.App || App.__manualEntrySearchSeparationInstalled) return;
  App.__manualEntrySearchSeparationInstalled = true;

  // Keep the lower New Entry field independent from the upper saved-food
  // search. Its only suggestions are a short list of recently CREATED foods.
  App.syncManualSuggestions = function() {
    const input = document.getElementById('manualName');
    const dropdown = document.getElementById('manualRecentAddedFoods');
    if (!input || !dropdown) return;

    if (input.value.trim()) {
      dropdown.hidden = true;
      return;
    }

    if (document.activeElement === input) dropdown.hidden = false;
  };

  const recentlyAddedFoods = () => [...(App.cache?.foods || [])]
    .map(food => ({
      food,
      addedAt: Date.parse(food.createdAt || ''),
    }))
    .filter(item => Number.isFinite(item.addedAt))
    .sort((a, b) => b.addedAt - a.addedAt
      || String(a.food.name || '').localeCompare(String(b.food.name || '')))
    .slice(0, 5)
    .map(item => item.food);

  const closeDropdown = () => {
    const dropdown = document.getElementById('manualRecentAddedFoods');
    if (dropdown) dropdown.hidden = true;
  };

  const enhanceManualName = () => {
    const input = document.getElementById('manualName');
    if (!input || input.dataset.recentAddedReady === 'true') return;

    input.dataset.recentAddedReady = 'true';
    const label = input.closest('label');
    if (!label) return;
    label.classList.add('manual-name-recent-anchor');

    const foods = recentlyAddedFoods();
    if (!foods.length) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'manualRecentAddedFoods';
    dropdown.className = 'manual-recent-added-dropdown';
    dropdown.hidden = true;
    dropdown.innerHTML = `
      <div class="manual-recent-added-heading">Recently added</div>
      <div class="manual-recent-added-list">
        ${foods.map(food => `
          <button
            type="button"
            class="manual-recent-added-item"
            data-food-id="${App.attr(food.id)}"
          >
            <span class="manual-recent-added-main">
              <strong>${App.esc(food.name || 'Unnamed Food')}</strong>
              ${food.source ? `<span class="tiny muted">${App.esc(food.source)}</span>` : ''}
            </span>
            <span class="manual-recent-added-calories">${App.formatNumber(food.calories)} cal</span>
          </button>
        `).join('')}
      </div>
    `;

    label.appendChild(dropdown);

    dropdown.querySelectorAll('.manual-recent-added-item').forEach(button => {
      // pointerdown fires before the input blur, avoiding a visible flash as
      // the dropdown closes and the saved-food flow opens.
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        const foodId = button.dataset.foodId || '';
        if (!foodId) return;
        closeDropdown();
        App.chooseSavedFood(foodId);
      });
    });

    input.addEventListener('focus', () => {
      if (!input.value.trim()) dropdown.hidden = false;
    });

    input.addEventListener('input', () => {
      dropdown.hidden = Boolean(input.value.trim());
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') dropdown.hidden = true;
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!dropdown.contains(document.activeElement)) dropdown.hidden = true;
      }, 100);
    });
  };

  const originalOpenAddSheet = App.openAddSheet;
  App.openAddSheet = async function(...args) {
    const result = await originalOpenAddSheet.apply(this, args);
    enhanceManualName();
    return result;
  };

  document.addEventListener('pointerdown', event => {
    const dropdown = document.getElementById('manualRecentAddedFoods');
    if (!dropdown || dropdown.hidden) return;
    if (event.target.closest('.manual-name-recent-anchor')) return;
    dropdown.hidden = true;
  }, { passive: true });
})();
