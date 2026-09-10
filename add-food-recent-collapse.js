(() => {
  'use strict';

  if (!window.App || App.__addFoodRecentCollapseInstalled) return;
  App.__addFoodRecentCollapseInstalled = true;

  App.addDefaultSuggestionsHtml = function(_pinned, recent = []) {
    if (!recent.length) {
      return '<div class="muted small">Your recently logged foods will appear here. Search above to find any saved food.</div>';
    }

    return `
      <details class="add-food-recent-details">
        <summary class="add-food-recent-summary">
          <span>Recent</span>
          <span class="add-food-recent-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="add-food-recent-items">
          ${recent.map(food => this.searchResultFoodHtml(food)).join('')}
        </div>
      </details>`;
  };
})();
