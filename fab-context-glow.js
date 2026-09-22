(() => {
  'use strict';

  if (!window.App || App.__fabContextGlowInstalled) return;
  App.__fabContextGlowInstalled = true;

  const fab = document.getElementById('fab');
  const app = document.getElementById('app');
  if (!fab || !app) return;

  const overlay = document.createElement('div');
  overlay.id = 'fabContextGlow';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  let oneShotFrame = 0;
  let trackingFrame = 0;
  let trackingUntil = 0;
  let lastTargetTop = null;
  let lastTargetLeft = null;

  const markDayCompleteButton = () => [...document.querySelectorAll('button.btn.block.primary')]
    .find(button =>
      button.textContent.trim() === 'Mark day complete'
      && String(button.getAttribute('onclick') || '').includes('toggleDayComplete(true)')
    ) || null;

  const hide = () => {
    overlay.classList.remove('active');
  };

  const update = () => {
    if (fab.classList.contains('hidden') || App.view?.page !== 'today') {
      hide();
      return null;
    }

    const target = markDayCompleteButton();
    if (!target) {
      hide();
      return null;
    }

    const fabRect = fab.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const overlapWidth = Math.max(
      0,
      Math.min(fabRect.right, targetRect.right) - Math.max(fabRect.left, targetRect.left)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(fabRect.bottom, targetRect.bottom) - Math.max(fabRect.top, targetRect.top)
    );

    if (overlapWidth <= 0 || overlapHeight <= 0) {
      hide();
    } else {
      const centerX = fabRect.left + fabRect.width / 2 - targetRect.left;
      const centerY = fabRect.top + fabRect.height / 2 + 12 - targetRect.top;

      overlay.style.left = `${targetRect.left}px`;
      overlay.style.top = `${targetRect.top}px`;
      overlay.style.width = `${targetRect.width}px`;
      overlay.style.height = `${targetRect.height}px`;
      overlay.style.borderRadius = getComputedStyle(target).borderRadius;
      overlay.style.setProperty('--fab-context-x', `${centerX}px`);
      overlay.style.setProperty('--fab-context-y', `${centerY}px`);
      overlay.classList.add('active');
    }

    return {
      top: targetRect.top,
      left: targetRect.left,
    };
  };

  const track = now => {
    trackingFrame = 0;
    const position = update();

    if (position) {
      const moved = lastTargetTop === null
        || Math.abs(position.top - lastTargetTop) > 0.1
        || Math.abs(position.left - lastTargetLeft) > 0.1;

      lastTargetTop = position.top;
      lastTargetLeft = position.left;

      // Keep tracking while momentum scrolling is still moving the target,
      // even if iOS temporarily throttles scroll events.
      if (moved) trackingUntil = Math.max(trackingUntil, now + 180);
    }

    if (now < trackingUntil) {
      trackingFrame = requestAnimationFrame(track);
    } else {
      lastTargetTop = null;
      lastTargetLeft = null;
    }
  };

  const startTracking = (minimumMs = 220) => {
    trackingUntil = Math.max(trackingUntil, performance.now() + minimumMs);
    if (!trackingFrame) trackingFrame = requestAnimationFrame(track);
  };

  const scheduleOneShot = () => {
    if (trackingFrame || oneShotFrame) return;
    oneShotFrame = requestAnimationFrame(() => {
      oneShotFrame = 0;
      update();
    });
  };

  // Start a live RAF loop as soon as the user begins touching/scrolling.
  // This avoids relying on Safari's sometimes-laggy scroll event cadence.
  document.addEventListener('touchstart', () => startTracking(260), { passive: true, capture: true });
  document.addEventListener('touchmove', () => startTracking(260), { passive: true, capture: true });
  document.addEventListener('touchend', () => startTracking(420), { passive: true, capture: true });
  document.addEventListener('touchcancel', () => startTracking(260), { passive: true, capture: true });

  window.addEventListener('scroll', () => startTracking(240), { passive: true, capture: true });
  window.addEventListener('wheel', () => startTracking(240), { passive: true, capture: true });
  window.addEventListener('resize', scheduleOneShot, { passive: true });

  window.visualViewport?.addEventListener('scroll', () => startTracking(240), { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleOneShot, { passive: true });

  new MutationObserver(scheduleOneShot).observe(app, {
    childList: true,
    subtree: true,
  });

  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(scheduleOneShot);
    resizeObserver.observe(fab);
    resizeObserver.observe(app);
  }

  scheduleOneShot();
})();
