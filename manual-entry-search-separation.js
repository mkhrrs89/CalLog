(() => {
  'use strict';

  if (!window.App || App.__manualEntrySearchSeparationInstalled) return;
  App.__manualEntrySearchSeparationInstalled = true;

  // The lower "New entry" name field is for creating a manual log item only.
  // It must not mirror text into the upper saved-food search or reveal saved-food
  // suggestions. The upper search field remains the only control that drives
  // App.updateAddSearch().
  App.syncManualSuggestions = function() {};
})();
