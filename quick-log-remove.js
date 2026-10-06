setTimeout(() => {
  'use strict';

  if (!window.App || App.__quickLogRemoveInstalled) return;
  App.__quickLogRemoveInstalled = true;

  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;

  App.openSavedFoodLogger = function(id) {
    const result = originalOpenSavedFoodLogger.call(this, id);
    const food = this.cache.foods.find(item => item.id === id);
    const form = document.querySelector('#sheetContent form');

    if (!food?.pinned || !form || document.getElementById('removeFromQuickLogButton')) {
      return result;
    }

    const button = document.createElement('button');
    button.id = 'removeFromQuickLogButton';
    button.type = 'button';
    button.className = 'btn ghost block';
    button.textContent = 'Remove from Quick Log';
    button.addEventListener('click', () => App.removeFoodFromQuickLog(id));

    form.appendChild(button);
    return result;
  };

  App.removeFoodFromQuickLog = async function(id) {
    const food = this.cache.foods.find(item => item.id === id);
    if (!food) return;

    await this.db.put('foods', {
      ...food,
      pinned: false,
      updatedAt: new Date().toISOString(),
    });

    this.closeSheet();
    await this.refreshCache();
    await this.render();
    this.showToast('Removed from Quick Log');
  };
}, 0);
