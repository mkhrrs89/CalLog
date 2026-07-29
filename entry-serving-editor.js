(() => {
  const inferLoggedPortionCalories = entry => {
    const stored = Number(entry.portionCalories);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    const multiplier = Number(entry.multiplier);
    const base = Number(entry.baseCalories);
    if ((entry.portionName || '').toLowerCase() === 'default' && Number.isFinite(base) && base >= 0) return base;
    if (Number.isFinite(multiplier) && multiplier > 0) return Math.max(0, Number(entry.calories || 0) / multiplier);
    return Number.isFinite(base) && base >= 0 ? base : Math.max(0, Number(entry.calories || 0));
  };

  const entryServingSetup = entry => {
    const food = App.cache.foods.find(item => item.id === entry.foodId) || null;
    const name = entry.portionName || (food ? 'Default' : 'Manual');
    const calories = inferLoggedPortionCalories(entry);
    const rawMultiplier = Number(entry.multiplier);
    const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier >= 0 ? rawMultiplier : 1;
    const portions = food ? [
      { name: 'Default', calories: Math.max(0, Number(food.calories || 0)) },
      ...(food.portions || []).map(item => ({ name: item.name || 'Serving', calories: Math.max(0, Number(item.calories || 0)) })),
    ] : [];
    let selectedIndex = portions.findIndex(item => item.name.toLowerCase() === name.toLowerCase() && Math.abs(item.calories - calories) <= 0.5);
    if (selectedIndex < 0) {
      portions.push({ name, calories, logged: true });
      selectedIndex = portions.length - 1;
    }
    return { food, portions, selectedIndex, multiplier, calories };
  };

  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(id) {
    originalOpenEntryEditor.call(this, id);
    const entry = this.cache.entries.find(item => item.id === id);
    const form = document.querySelector('#modalContent form');
    const tagLabel = document.getElementById('editEntryTag')?.closest('label');
    if (!entry || !form || !tagLabel || document.getElementById('editEntryMultiplier')) return;
    const serving = entryServingSetup(entry);
    const portionField = serving.food
      ? `<label>Serving size<select id="editEntryPortion" onchange="App.updateEntryServingCalculation('${entry.id}')">${serving.portions.map((portion, index) => `<option value="${index}" ${index === serving.selectedIndex ? 'selected' : ''}>${this.esc(portion.name)} — ${this.formatNumber(portion.calories)} cal${portion.logged ? ' (logged)' : ''}</option>`).join('')}</select></label>`
      : `<label>Serving name<input id="editEntryPortionName" value="${this.attr(entry.portionName || 'Manual')}" /></label><label>Calories per serving<input id="editEntryPortionCalories" type="number" min="0" step="0.1" value="${Number(serving.calories.toFixed(2))}" oninput="App.updateEntryServingCalculation('${entry.id}')" /></label>`;
    const card = document.createElement('div');
    card.className = 'card subtle';
    card.innerHTML = `<h3>Serving</h3><div class="form-grid two">${portionField}<label>Number of servings<input id="editEntryMultiplier" type="number" min="0" step="0.1" value="${serving.multiplier}" oninput="App.updateEntryServingCalculation('${entry.id}')" /></label></div><div class="actions" style="margin-top:.55rem">${[0.5, 1, 1.5, 2].map(value => `<button type="button" class="chip ${Math.abs(serving.multiplier - value) < 0.001 ? 'active' : ''}" onclick="App.setEntryMultiplier(${value},this,'${entry.id}')">${value}×</button>`).join('')}</div><div class="row space small" style="margin-top:.65rem"><span class="muted">Calculated total</span><strong id="editEntryCalculatedCalories">${this.formatNumber(entry.calories)} cal</strong></div><p class="field-help" style="margin:.35rem 0 0">Changing the serving recalculates calories for this log only. The calorie field above still works normally.</p>`;
    form.insertBefore(card, tagLabel);
    const caloriesInput = document.getElementById('editEntryCalories');
    if (caloriesInput) caloriesInput.addEventListener('input', () => { caloriesInput.dataset.manual = 'true'; });
  };

  App.setEntryMultiplier = (value, button, entryId) => {
    const input = document.getElementById('editEntryMultiplier');
    if (input) input.value = value;
    button?.parentElement?.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
    button?.classList.add('active');
    App.updateEntryServingCalculation(entryId);
  };

  App.updateEntryServingCalculation = entryId => {
    const entry = App.cache.entries.find(item => item.id === entryId);
    if (!entry) return;
    const serving = entryServingSetup(entry);
    const multiplier = Number(document.getElementById('editEntryMultiplier')?.value);
    const select = document.getElementById('editEntryPortion');
    const portionCalories = select
      ? Number((serving.portions[Number(select.value)] || serving.portions[serving.selectedIndex])?.calories || 0)
      : Number(document.getElementById('editEntryPortionCalories')?.value);
    if (!Number.isFinite(multiplier) || multiplier < 0 || !Number.isFinite(portionCalories) || portionCalories < 0) return;
    const calories = Math.round(portionCalories * multiplier);
    const caloriesInput = document.getElementById('editEntryCalories');
    if (caloriesInput) {
      caloriesInput.value = calories;
      caloriesInput.dataset.manual = 'false';
    }
    const total = document.getElementById('editEntryCalculatedCalories');
    if (total) total.textContent = `${App.formatNumber(calories)} cal`;
    document.querySelectorAll('#modalContent .chip').forEach(chip => {
      chip.classList.toggle('active', Math.abs(Number(chip.textContent.replace('×', '')) - multiplier) < 0.001);
    });
  };

  const originalSaveEntryEdit = App.saveEntryEdit;
  App.saveEntryEdit = async function(id) {
    const entry = this.cache.entries.find(item => item.id === id);
    if (!entry) return;
    const multiplier = Number(document.getElementById('editEntryMultiplier')?.value);
    if (!Number.isFinite(multiplier) || multiplier < 0) return this.showToast('Enter a serving amount of 0 or more');
    const serving = entryServingSetup(entry);
    const select = document.getElementById('editEntryPortion');
    let portionName;
    let portionCalories;
    if (select) {
      const selected = serving.portions[Number(select.value)] || serving.portions[serving.selectedIndex];
      portionName = selected?.name || 'Default';
      portionCalories = Number(selected?.calories || 0);
    } else {
      portionName = document.getElementById('editEntryPortionName')?.value.trim() || entry.portionName || 'Manual';
      portionCalories = Number(document.getElementById('editEntryPortionCalories')?.value);
      if (!Number.isFinite(portionCalories) || portionCalories < 0) return this.showToast('Enter calories per serving of 0 or more');
    }
    const caloriesInput = document.getElementById('editEntryCalories');
    const calories = Number(caloriesInput?.value);
    if (caloriesInput?.dataset.manual === 'true' && Number.isFinite(calories) && calories >= 0 && multiplier > 0) portionCalories = calories / multiplier;
    entry.multiplier = multiplier;
    entry.portionName = portionName;
    entry.portionCalories = Math.max(0, portionCalories);
    await originalSaveEntryEdit.call(this, id);
  };
})();
