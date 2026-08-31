(() => {
  'use strict';

  if (!window.App || App.__recipeDecimalAmountsInstalled) return;
  App.__recipeDecimalAmountsInstalled = true;

  const enableRecipeDecimals = () => {
    document.querySelectorAll('.recipe-quantity-input input[type="number"]').forEach(input => {
      input.min = '0.01';
      input.step = 'any';
      input.inputMode = 'decimal';
    });
  };

  if (typeof App.renderRecipeIngredientRows === 'function') {
    const originalRenderRecipeIngredientRows = App.renderRecipeIngredientRows;
    App.renderRecipeIngredientRows = function(...args) {
      const result = originalRenderRecipeIngredientRows.apply(this, args);
      enableRecipeDecimals();
      return result;
    };
  }

  const modalContent = document.getElementById('modalContent');
  if (modalContent) {
    new MutationObserver(enableRecipeDecimals).observe(modalContent, { childList: true, subtree: true });
  }

  enableRecipeDecimals();
})();
