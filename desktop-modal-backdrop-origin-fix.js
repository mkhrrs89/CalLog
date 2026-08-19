(() => {
  'use strict';

  if (!window.App || App.__desktopModalBackdropOriginFixInstalled) return;
  App.__desktopModalBackdropOriginFixInstalled = true;

  const backdrop = document.getElementById('modalBackdrop');
  if (!backdrop) return;

  let activeMousePointerId = null;
  let startedOnBackdrop = false;
  let suppressLegacyClick = false;
  let suppressTimer = null;

  const resetPointerState = () => {
    activeMousePointerId = null;
    startedOnBackdrop = false;
  };

  backdrop.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    activeMousePointerId = event.pointerId;
    startedOnBackdrop = event.target === backdrop;
  }, true);

  document.addEventListener('pointerup', event => {
    if (event.pointerType !== 'mouse' || event.pointerId !== activeMousePointerId) return;

    const shouldClose = startedOnBackdrop;
    resetPointerState();

    // The browser will usually dispatch a click immediately after pointerup.
    // Suppress that legacy backdrop click so release position cannot override
    // the press-origin decision made above.
    suppressLegacyClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressLegacyClick = false;
    }, 0);

    if (shouldClose && !backdrop.classList.contains('hidden')) {
      App.closeModal();
    }
  }, true);

  document.addEventListener('pointercancel', event => {
    if (event.pointerType === 'mouse' && event.pointerId === activeMousePointerId) {
      resetPointerState();
    }
  }, true);

  const originalModalBackdropClose = App.modalBackdropClose;
  App.modalBackdropClose = function(event) {
    if (suppressLegacyClick) {
      suppressLegacyClick = false;
      return;
    }
    return originalModalBackdropClose.call(this, event);
  };
})();
