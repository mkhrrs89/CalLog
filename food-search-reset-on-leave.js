setTimeout(() => {
  'use strict';

  if (!window.App || App.__foodSearchResetOnLeaveInstalled) return;
  App.__foodSearchResetOnLeaveInstalled = true;

  const originalGo = App.go;

  App.go = async function(page) {
    if (this.view?.page === 'foods' && page !== 'foods') {
      this.view.foodQuery = '';
    }
    return originalGo.call(this, page);
  };
}, 0);
