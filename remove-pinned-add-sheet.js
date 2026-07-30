(() => {
  App.addDefaultSuggestionsHtml = function(_pinned, recent) {
    if (!recent.length) {
      return '<div class="muted small">Your recently logged foods will appear here. Search above to find any saved food.</div>';
    }

    return `<div class="group-head">Recent</div>${recent.map(food => this.searchResultFoodHtml(food)).join('')}`;
  };
})();
