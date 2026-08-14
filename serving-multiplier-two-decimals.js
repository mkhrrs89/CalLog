(() => {
  'use strict';

  if (!window.App || App.__twoDecimalServingMultiplierInstalled) return;
  App.__twoDecimalServingMultiplierInstalled = true;

  const enableTwoDecimals = input => {
    if (!input) return;
    input.step = '0.01';
    input.setAttribute('inputmode', 'decimal');
  };

  const originalOpenSavedFoodLogger = App.openSavedFoodLogger;
  App.openSavedFoodLogger = function(...args) {
    const result = originalOpenSavedFoodLogger.apply(this, args);
    enableTwoDecimals(document.getElementById('savedMultiplier'));
    return result;
  };

  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(...args) {
    const result = originalOpenEntryEditor.apply(this, args);
    enableTwoDecimals(document.getElementById('editEntryMultiplier'));
    return result;
  };
})();
