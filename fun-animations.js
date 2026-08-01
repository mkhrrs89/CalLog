(() => {
  if (App.__funAnimationsInstalled) return;
  App.__funAnimationsInstalled = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let celebrationTimer = null;
  const originalAfterLog = App.afterLog;

  App.afterLog = async function(...args) {
    const result = await originalAfterLog.apply(this, args);
    if (reducedMotion.matches) return result;

    document.body.classList.remove('foodlog-celebrate');
    void document.body.offsetWidth;
    document.body.classList.add('foodlog-celebrate');
    window.clearTimeout(celebrationTimer);
    celebrationTimer = window.setTimeout(() => {
      document.body.classList.remove('foodlog-celebrate');
    }, 760);

    return result;
  };
})();
