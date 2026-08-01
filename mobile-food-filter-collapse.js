(() => {
  const mobileQuery = '(max-width: 719px)';
  const filterPanelPattern = /<section class="card subtle" style="margin-top:\.75rem">([\s\S]*?<label>Sort by[\s\S]*?)<\/section>/;

  const activeOptionCount = () => [
    App.view.foodTagFilter,
    App.view.foodMealTagFilter,
    App.view.foodSourceFilter,
    App.view.foodFolderFilter,
    App.view.foodSort !== 'name' ? App.view.foodSort : '',
  ].filter(Boolean).length;

  const originalRenderFoods = App.renderFoods;
  App.renderFoods = async function() {
    const html = await originalRenderFoods.call(this);
    if (!window.matchMedia(mobileQuery).matches) return html;

    if (this.view.foodFiltersExpanded === undefined) {
      this.view.foodFiltersExpanded = false;
    }

    const activeCount = activeOptionCount();
    const openAttribute = this.view.foodFiltersExpanded ? ' open' : '';

    return html.replace(filterPanelPattern, (panel, content) => `
      <details class="card subtle" style="margin-top:.75rem"${openAttribute} ontoggle="App.setFoodFiltersExpanded(this.open)">
        <summary style="cursor:pointer;font-weight:800">
          Filters &amp; sorting${activeCount ? ` <span class="tiny muted">· ${activeCount} active</span>` : ''}
        </summary>
        <div style="margin-top:.75rem">${content}</div>
      </details>`);
  };

  App.setFoodFiltersExpanded = function(open) {
    this.view.foodFiltersExpanded = Boolean(open);
  };
})();
