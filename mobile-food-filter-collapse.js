(() => {
  const mobileQuery = window.matchMedia('(max-width: 719px)');
  const app = document.getElementById('app');
  if (!app) return;

  if (App.view.foodFiltersExpanded === undefined) {
    App.view.foodFiltersExpanded = false;
  }

  const activeOptionCount = () => [
    App.view.foodTagFilter,
    App.view.foodMealTagFilter,
    App.view.foodSourceFilter,
    App.view.foodFolderFilter,
    App.view.foodSort !== 'name' ? App.view.foodSort : '',
  ].filter(Boolean).length;

  const findFilterPanels = () => [...app.querySelectorAll('section.card.subtle')]
    .filter(panel => panel.querySelector('select[onchange*="foodSort"]'));

  const enhanceFilters = () => {
    if (App.view.page !== 'foods') return;

    const existingDetails = app.querySelector('details.food-filter-details');
    const panels = findFilterPanels();

    if (existingDetails) {
      panels.forEach(panel => panel.remove());
      return;
    }

    if (!panels.length) return;

    const panel = panels.shift();
    panels.forEach(duplicate => duplicate.remove());

    if (!mobileQuery.matches) return;

    const details = document.createElement('details');
    details.className = 'card subtle food-filter-details';
    details.style.marginTop = '.75rem';
    details.open = Boolean(App.view.foodFiltersExpanded);

    const activeCount = activeOptionCount();
    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = '800';
    summary.innerHTML = `Filters &amp; sorting${activeCount ? ` <span class="tiny muted">· ${activeCount} active</span>` : ''}`;

    const content = document.createElement('div');
    content.style.marginTop = '.75rem';
    while (panel.firstChild) content.appendChild(panel.firstChild);

    details.append(summary, content);
    panel.replaceWith(details);
    details.addEventListener('toggle', () => {
      App.view.foodFiltersExpanded = details.open;
    });
  };

  let queued = false;
  const queueEnhancement = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      enhanceFilters();
    });
  };

  new MutationObserver(queueEnhancement).observe(app, { childList: true, subtree: true });
  mobileQuery.addEventListener?.('change', () => App.render());
  queueEnhancement();
})();
