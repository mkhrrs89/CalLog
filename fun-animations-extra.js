(() => {
  'use strict';

  if (!window.App || App.__funAnimationsExtraInstalled) return;
  App.__funAnimationsExtraInstalled = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const appRoot = document.getElementById('app');
  let pendingLog = null;
  let pendingLogTimer = 0;

  const displayedTotal = () => {
    const element = document.querySelector('.total-number');
    return Number(String(element?.textContent || '').replace(/[^0-9.-]/g, '')) || 0;
  };

  const centerOf = element => {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight * 0.72 };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const restartClass = (element, className, duration = 520) => {
    if (!element || reducedMotion.matches) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
  };

  const latestEntryRow = () => {
    const date = App.view?.date;
    const entries = (App.cache?.entries || [])
      .filter(entry => entry.date === date)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const latest = entries[0];
    if (!latest) return null;

    const escapedId = window.CSS?.escape ? CSS.escape(latest.id) : latest.id.replace(/['"\\]/g, '\\$&');
    return document.querySelector(`.swipe-entry[data-entry-id="${escapedId}"] .entry-row`)
      || document.querySelector(`.entry-row[onclick*="${escapedId}"]`);
  };

  const launchCalorieFly = (from, delta) => {
    if (reducedMotion.matches || !Number.isFinite(delta) || delta <= 0) return;
    const target = document.querySelector('.total-number');
    if (!target) return;

    const to = centerOf(target);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const bubble = document.createElement('div');
    bubble.className = 'foodlog-calorie-fly';
    bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = `+${App.formatNumber(delta)} cal`;
    bubble.style.left = `${from.x}px`;
    bubble.style.top = `${from.y}px`;
    bubble.style.setProperty('--fly-x', `${dx.toFixed(1)}px`);
    bubble.style.setProperty('--fly-y', `${dy.toFixed(1)}px`);
    bubble.style.setProperty('--fly-half-x', `${(dx * 0.52).toFixed(1)}px`);
    bubble.style.setProperty('--fly-half-y', `${(dy * 0.52 - 30).toFixed(1)}px`);
    document.body.appendChild(bubble);

    restartClass(target, 'foodlog-total-catch', 650);
    window.requestAnimationFrame(() => restartClass(latestEntryRow(), 'foodlog-entry-land', 620));
    window.setTimeout(() => bubble.remove(), 980);
  };

  const rememberPotentialLog = target => {
    if (reducedMotion.matches) return;
    pendingLog = {
      before: displayedTotal(),
      origin: centerOf(target),
      startedAt: performance.now(),
    };
    window.clearTimeout(pendingLogTimer);
    pendingLogTimer = window.setTimeout(() => { pendingLog = null; }, 2200);
  };

  const isLogSubmit = target => {
    const button = target.closest('button[type="submit"]');
    if (!button) return null;
    const form = button.closest('form');
    if (!form) return null;
    if (form.id === 'manualEntryForm') return button;
    if (form.querySelector('#savedPortion, #savedCalculatedCalories')) return button;
    return null;
  };

  // Submit buttons are safe to animate from pointerdown because they are not
  // part of the scrollable Quick Log grid.
  document.addEventListener('pointerdown', event => {
    if (event.button > 0) return;

    const submit = isLogSubmit(event.target);
    if (submit) {
      rememberPotentialLog(submit);
      restartClass(submit, 'foodlog-quick-punch', 430);
    }

    const chip = event.target.closest('.chip');
    if (chip) restartClass(chip, 'foodlog-chip-pop', 360);
  }, { passive: true });

  // Quick Log feedback begins only after a real click/tap has been recognized.
  // iPhone scrolling does not emit this click, so tiles under the scrolling
  // finger remain still.
  document.addEventListener('click', event => {
    if (reducedMotion.matches) return;
    const quick = event.target.closest('.quick-food-main');
    if (!quick) return;

    rememberPotentialLog(quick);
    restartClass(quick.closest('.quick-food') || quick, 'foodlog-quick-punch', 430);
  }, true);

  document.addEventListener('submit', event => {
    if (reducedMotion.matches || pendingLog) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id !== 'manualEntryForm' && !form.querySelector('#savedPortion, #savedCalculatedCalories')) return;
    rememberPotentialLog(form.querySelector('button[type="submit"]') || form);
  }, true);

  document.addEventListener('change', event => {
    const control = event.target;
    if (!(control instanceof HTMLElement) || reducedMotion.matches) return;

    if (control.matches('input[type="checkbox"]')) {
      restartClass(control, 'foodlog-checkbox-pop', 430);
      restartClass(control.closest('label'), 'foodlog-control-confirm', 520);
      return;
    }

    if (control.matches('select')) {
      restartClass(control.closest('label'), 'foodlog-control-confirm', 520);
    }
  }, true);

  if (appRoot) {
    new MutationObserver(() => {
      if (!pendingLog || performance.now() - pendingLog.startedAt > 2200) return;
      const totalElement = document.querySelector('.total-number');
      if (!totalElement) return;
      const next = displayedTotal();
      const delta = next - pendingLog.before;
      if (delta <= 0) return;

      const origin = pendingLog.origin;
      pendingLog = null;
      window.clearTimeout(pendingLogTimer);
      window.requestAnimationFrame(() => launchCalorieFly(origin, delta));
    }).observe(appRoot, { childList: true, subtree: true, characterData: true });
  }

  // meal-tag-drag.js is loaded before this module, so wrap its final move method
  // without changing any of the drag/drop behavior itself.
  if (typeof App.moveEntryToMealTag === 'function' && !App.__funMoveEntryAnimationWrapped) {
    App.__funMoveEntryAnimationWrapped = true;
    const originalMoveEntryToMealTag = App.moveEntryToMealTag;
    App.moveEntryToMealTag = async function(entryId, mealTagId, ...args) {
      const result = await originalMoveEntryToMealTag.call(this, entryId, mealTagId, ...args);
      if (reducedMotion.matches) return result;

      window.requestAnimationFrame(() => {
        const escapedId = window.CSS?.escape ? CSS.escape(mealTagId) : mealTagId.replace(/['"\\]/g, '\\$&');
        const group = document.querySelector(`.meal-tag-group[data-meal-tag-id="${escapedId}"]`);
        restartClass(group, 'foodlog-drop-success', 760);
      });
      return result;
    };
  }
})();
