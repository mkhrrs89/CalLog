(() => {
  'use strict';

  const root = document.documentElement;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const touchCapable = (navigator.maxTouchPoints || 0) > 0;
  const shortSide = Math.min(
    Number(window.screen?.width || Infinity),
    Number(window.screen?.height || Infinity)
  );

  // Only force this on actual phone-sized touch devices. Tablets/desktops keep
  // the normal responsive breakpoints.
  if (!(shortSide <= 600 && (coarsePointer || touchCapable))) return;

  const syncPhoneLayout = () => {
    const portrait = window.matchMedia?.('(orientation: portrait)').matches !== false;
    const screenWidth = Number(window.screen?.width || shortSide);
    const screenHeight = Number(window.screen?.height || shortSide);
    const deviceWidth = Math.round(portrait
      ? Math.min(screenWidth, screenHeight)
      : Math.max(screenWidth, screenHeight));

    root.classList.add('foodlog-force-phone-layout');
    root.style.setProperty('--foodlog-phone-width', `${deviceWidth}px`);

    // Keep the viewport declaration authoritative if iOS/browser UI has
    // temporarily promoted the page to a desktop-style layout viewport.
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute(
        'content',
        'width=device-width, initial-scale=1, viewport-fit=cover'
      );
    }
  };

  syncPhoneLayout();
  window.addEventListener('orientationchange', () => {
    window.setTimeout(syncPhoneLayout, 80);
  });
})();
