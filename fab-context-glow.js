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

  let frame = 0;

  const markDayCompleteButton = () => [...document.querySelectorAll('button.btn.block.primary')]
    .find(button =>
      button.textContent.trim() === 'Mark day complete'
      && String(button.getAttribute('onclick') || '').includes('toggleDayComplete(true)')
    ) || null;

  const hide = () => {
    overlay.classList.remove('active');
  };

  const update = () => {
    frame = 0;

    if (fab.classList.contains('hidden') || App.view?.page !== 'today') {
      hide();
      return;
    }

    const target = markDayCompleteButton();
    if (!target) {
      hide();
      return;
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

    // The contextual black glow appears only once the actual + button overlaps
    // the teal completion button. The overlay itself is clipped to that teal
    // button, so partial overlap naturally produces a split black/teal glow.
    if (overlapWidth <= 0 || overlapHeight <= 0) {
      hide();
      return;
    }

    const centerX = fabRect.left + fabRect.width / 2 - targetRect.left;
    // Match the existing FAB shadow's downward bias (0 16px 30px).
    const centerY = fabRect.top + fabRect.height / 2 + 12 - targetRect.top;

    overlay.style.left = `${targetRect.left}px`;
    overlay.style.top = `${targetRect.top}px`;
    overlay.style.width = `${targetRect.width}px`;
    overlay.style.height = `${targetRect.height}px`;
    overlay.style.borderRadius = getComputedStyle(target).borderRadius;
    overlay.style.setProperty('--fab-context-x', `${centerX}px`);
    overlay.style.setProperty('--fab-context-y', `${centerY}px`);
    overlay.classList.add('active');
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });

  new MutationObserver(schedule).observe(app, {
    childList: true,
    subtree: true,
  });

  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(fab);
    resizeObserver.observe(app);
  }

  schedule();
})();
