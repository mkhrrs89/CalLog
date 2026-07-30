(() => {
  const emptyValue = '__none__';
  const defaults = {
    foodSort: 'name',
    foodTagFilter: '',
    foodMealTagFilter: '',
    foodSourceFilter: '',
    foodFolderFilter: '',
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (App.view[key] === undefined) App.view[key] = value;
  });

  const uniqueValues = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const filterOptions = (values, selected, allLabel, noneLabel) => `
    <option value="">${allLabel}</option>
    <option value="${emptyValue}" ${selected === emptyValue ? 'selected' : ''}>${noneLabel}</option>
    ${values.map(value => `<option value="${App.attr(value)}" ${selected === value ? 'selected' : ''}>${App.esc(value)}</option>`).join('')}`;

  const hasActiveFilters = () => Boolean(
    App.view.foodTagFilter ||
    App.view.foodMealTagFilter ||
    App.view.foodSourceFilter ||
    App.view.foodFolderFilter ||
    App.view.foodSort !== 'name'
  );

  const originalRenderFoods = App.renderFoods;
  App.renderFoods = async function() {
    const html = await originalRenderFoods.call(this);
    const foodTags = uniqueValues(this.cache.foods.flatMap(food => food.tags || []));
    const sources = uniqueValues(this.cache.foods.map(food => food.source));
    const folders = uniqueValues(this.cache.foods.map(food => food.folder));
    const mealTagOptions = this.cache.tags.map(tag => `<option value="${this.attr(tag.id)}" ${this.view.foodMealTagFilter === tag.id ? 'selected' : ''}>${this.esc(tag.name)}</option>`).join('');
    const controls = `
      <section class="card subtle" style="margin-top:.75rem">
        <div class="form-grid two">
          <label>Sort by
            <select onchange="App.setFoodLibraryOption('foodSort',this.value)">
              <option value="name" ${this.view.foodSort === 'name' ? 'selected' : ''}>Name A–Z</option>
              <option value="nameDesc" ${this.view.foodSort === 'nameDesc' ? 'selected' : ''}>Name Z–A</option>
              <option value="mostUsed" ${this.view.foodSort === 'mostUsed' ? 'selected' : ''}>Most used</option>
              <option value="recent" ${this.view.foodSort === 'recent' ? 'selected' : ''}>Recently used</option>
              <option value="caloriesLow" ${this.view.foodSort === 'caloriesLow' ? 'selected' : ''}>Calories: low to high</option>
              <option value="caloriesHigh" ${this.view.foodSort === 'caloriesHigh' ? 'selected' : ''}>Calories: high to low</option>
              <option value="source" ${this.view.foodSort === 'source' ? 'selected' : ''}>Source</option>
              <option value="folder" ${this.view.foodSort === 'folder' ? 'selected' : ''}>Folder</option>
              <option value="defaultMealTag" ${this.view.foodSort === 'defaultMealTag' ? 'selected' : ''}>Default meal tag</option>
            </select>
          </label>
          <label>Food tag
            <select onchange="App.setFoodLibraryOption('foodTagFilter',this.value)">${filterOptions(foodTags, this.view.foodTagFilter, 'All food tags', 'No food tags')}</select>
          </label>
          <label>Default meal tag
            <select onchange="App.setFoodLibraryOption('foodMealTagFilter',this.value)">
              <option value="">All default meal tags</option>
              <option value="${emptyValue}" ${this.view.foodMealTagFilter === emptyValue ? 'selected' : ''}>No default meal tag</option>
              ${mealTagOptions}
            </select>
          </label>
          <label>Source
            <select onchange="App.setFoodLibraryOption('foodSourceFilter',this.value)">${filterOptions(sources, this.view.foodSourceFilter, 'All sources', 'No source')}</select>
          </label>
          <label>Folder
            <select onchange="App.setFoodLibraryOption('foodFolderFilter',this.value)">${filterOptions(folders, this.view.foodFolderFilter, 'All folders', 'No folder')}</select>
          </label>
        </div>
        ${hasActiveFilters() ? '<div class="actions" style="margin-top:.65rem"><button class="btn ghost small-btn" type="button" onclick="App.clearFoodLibraryFilters()">Clear filters</button></div>' : ''}
      </section>`;
    return html.replace(/(<label>Search database[\s\S]*?<\/label>)/, `$1${controls}`);
  };

  const matchesText = (food, query) => {
    const q = App.normalizeName(query);
    if (!q) return true;
    const terms = q.split(' ').filter(Boolean);
    const mealTag = App.cache.tags.find(tag => tag.id === food.defaultMealTagId)?.name || '';
    const haystack = [
      food.name,
      ...(food.aliases || []),
      ...(food.tags || []),
      food.source,
      food.folder,
      mealTag,
    ].map(value => App.normalizeName(value)).join(' ');
    return terms.every(term => haystack.includes(term));
  };

  const matchesExact = (value, filter) => {
    if (!filter) return true;
    const clean = String(value || '').trim();
    return filter === emptyValue ? !clean : clean === filter;
  };

  const filteredFoods = query => App.cache.foods.filter(food => {
    if (!matchesText(food, query)) return false;
    if (App.view.foodTagFilter) {
      const tags = food.tags || [];
      if (App.view.foodTagFilter === emptyValue ? tags.length : !tags.includes(App.view.foodTagFilter)) return false;
    }
    if (App.view.foodMealTagFilter) {
      const id = food.defaultMealTagId || '';
      if (App.view.foodMealTagFilter === emptyValue ? Boolean(id) : id !== App.view.foodMealTagFilter) return false;
    }
    if (!matchesExact(food.source, App.view.foodSourceFilter)) return false;
    if (!matchesExact(food.folder, App.view.foodFolderFilter)) return false;
    return true;
  });

  const sortFoods = foods => {
    const tagName = food => App.cache.tags.find(tag => tag.id === food.defaultMealTagId)?.name || '';
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      nameDesc: (a, b) => b.name.localeCompare(a.name),
      mostUsed: (a, b) => (b.useCount || 0) - (a.useCount || 0) || a.name.localeCompare(b.name),
      recent: (a, b) => new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0) || a.name.localeCompare(b.name),
      caloriesLow: (a, b) => Number(a.calories || 0) - Number(b.calories || 0) || a.name.localeCompare(b.name),
      caloriesHigh: (a, b) => Number(b.calories || 0) - Number(a.calories || 0) || a.name.localeCompare(b.name),
      source: (a, b) => (a.source || '').localeCompare(b.source || '') || a.name.localeCompare(b.name),
      folder: (a, b) => (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name),
      defaultMealTag: (a, b) => tagName(a).localeCompare(tagName(b)) || a.name.localeCompare(b.name),
    };
    return [...foods].sort(sorters[App.view.foodSort] || sorters.name);
  };

  App.foodResultsHtml = function(query = '') {
    const foods = sortFoods(filteredFoods(query));
    if (!this.cache.foods.length) return '<div class="empty-state">Your saved food database is empty.</div>';
    if (!foods.length) return '<div class="empty-state">No saved foods match the current search and filters.</div>';
    const active = Boolean(this.normalizeName(query)) || hasActiveFilters();
    if (active) {
      return `<section class="section"><div class="section-title"><h2>Results</h2><span class="tiny muted">${foods.length} food${foods.length === 1 ? '' : 's'}</span></div><div class="food-list">${foods.map(food => this.foodRowHtml(food)).join('')}</div></section>`;
    }
    const pinned = foods.filter(food => food.pinned).sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
    const recent = [...foods].filter(food => food.lastUsedAt).sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt)).slice(0, 10);
    return `
      ${pinned.length ? `<section class="section"><div class="section-title"><h2>Pinned</h2></div><div class="food-list">${pinned.map(food => this.foodRowHtml(food)).join('')}</div></section>` : ''}
      ${recent.length ? `<section class="section"><div class="section-title"><h2>Recent</h2></div><div class="food-list">${recent.map(food => this.foodRowHtml(food)).join('')}</div></section>` : ''}
      <section class="section"><div class="section-title"><h2>All Foods</h2></div><div class="food-list">${foods.map(food => this.foodRowHtml(food)).join('')}</div></section>`;
  };

  App.setFoodLibraryOption = function(key, value) {
    this.view[key] = value;
    this.render();
  };

  App.clearFoodLibraryFilters = function() {
    Object.assign(this.view, defaults);
    this.render();
  };
})();
