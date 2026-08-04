(() => {
  'use strict';

  if (App.__funAnimationsInstalled) return;
  App.__funAnimationsInstalled = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Map();

  const parseDisplayedNumber = element => {
    if (!element) return 0;
    return Number(String(element.textContent || '').replace(/[^0-9.-]/g, '')) || 0;
  };

  const pulseBodyClass = (className, duration) => {
    document.body.classList.remove(className);
    void document.body.offsetWidth;
    document.body.classList.add(className);

    window.clearTimeout(timers.get(className));
    timers.set(className, window.setTimeout(() => {
      document.body.classList.remove(className);
      timers.delete(className);
    }, duration));
  };

  const animateNumber = (element, from, to, duration = 430) => {
    if (!element || from === to || reducedMotion.matches) return;

    const startedAt = performance.now();
    const difference = to - from;
    const easeOut = value => 1 - Math.pow(1 - value, 3);

    const frame = now => {
      const progress = Math.min(1, (now - startedAt) / duration);
      element.textContent = App.formatNumber(from + difference * easeOut(progress));
      if (progress < 1) requestAnimationFrame(frame);
      else element.textContent = App.formatNumber(to);
    };

    requestAnimationFrame(frame);
  };

  const confettiOrigin = element => {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) {
      return { x: window.innerWidth / 2, y: window.innerHeight * 0.62 };
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };

  const launchConfetti = (origin, count = 28) => {
    if (reducedMotion.matches) return;

    const layer = document.createElement('div');
    layer.className = 'foodlog-confetti-layer';
    layer.setAttribute('aria-hidden', 'true');

    for (let index = 0; index < count; index += 1) {
      const piece = document.createElement('i');
      const angle = (Math.PI * 2 * index / count) + ((Math.random() - 0.5) * 0.45);
      const distance = 85 + Math.random() * 155;
      const rise = 30 + Math.random() * 105;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance - rise;

      piece.className = `foodlog-confetti-piece color-${index % 5}`;
      piece.style.left = `${origin.x}px`;
      piece.style.top = `${origin.y}px`;
      piece.style.setProperty('--confetti-x', `${x.toFixed(1)}px`);
      piece.style.setProperty('--confetti-y', `${y.toFixed(1)}px`);
      piece.style.setProperty('--confetti-rotation', `${Math.round((Math.random() - 0.5) * 900)}deg`);
      piece.style.setProperty('--confetti-delay', `${Math.round(Math.random() * 90)}ms`);
      piece.style.setProperty('--confetti-duration', `${760 + Math.round(Math.random() * 360)}ms`);
      layer.appendChild(piece);
    }

    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 1350);
  };

  const originalAfterLog = App.afterLog;
  if (typeof originalAfterLog === 'function') {
    App.afterLog = async function(...args) {
      const previousTotal = parseDisplayedNumber(document.querySelector('.total-number'));
      const result = await originalAfterLog.apply(this, args);

      if (reducedMotion.matches) return result;

      const totalElement = document.querySelector('.total-number');
      const nextTotal = parseDisplayedNumber(totalElement);
      animateNumber(totalElement, previousTotal, nextTotal);
      pulseBodyClass('foodlog-celebrate', 780);

      return result;
    };
  }

  const originalChangeDate = App.changeDate;
  if (typeof originalChangeDate === 'function') {
    App.changeDate = async function(amount, ...args) {
      if (!reducedMotion.matches) {
        document.body.classList.remove('foodlog-date-next', 'foodlog-date-previous');
        document.body.classList.add(amount < 0 ? 'foodlog-date-previous' : 'foodlog-date-next');
      }

      const result = await originalChangeDate.call(this, amount, ...args);
      window.setTimeout(() => {
        document.body.classList.remove('foodlog-date-next', 'foodlog-date-previous');
      }, 390);
      return result;
    };
  }

  const originalToggleDayComplete = App.toggleDayComplete;
  if (typeof originalToggleDayComplete === 'function') {
    App.toggleDayComplete = async function(complete, ...args) {
      const origin = confettiOrigin(document.activeElement?.closest?.('button') || document.querySelector('.total-card'));
      const result = await originalToggleDayComplete.call(this, complete, ...args);

      if (complete && !reducedMotion.matches) {
        pulseBodyClass('foodlog-day-complete', 1250);
        launchConfetti(origin);
      }

      return result;
    };
  }

  document.addEventListener('pointerdown', event => {
    if (reducedMotion.matches || event.button > 0) return;

    const target = event.target.closest(
      'button, .entry-row, .food-row, .search-result, .quick-food'
    );
    if (!target || target.disabled) return;

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    const diameter = Math.max(rect.width, rect.height) * 1.25;

    target.classList.add('foodlog-ripple-host');
    ripple.className = 'foodlog-ripple';
    ripple.style.width = `${diameter}px`;
    ripple.style.height = `${diameter}px`;
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    target.appendChild(ripple);

    window.setTimeout(() => ripple.remove(), 660);
  }, { passive: true });
})();
