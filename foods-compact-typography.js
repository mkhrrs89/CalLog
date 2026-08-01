(() => {
  if (App.__foodsCompactTypographyInstalled) return;
  App.__foodsCompactTypographyInstalled = true;

  const syncPageClass = () => {
    document.body.classList.toggle('foods-page-compact-type', App.view.page === 'foods');
  };

  const originalRender = App.render;
  App.render = async function(...args) {
    syncPageClass();
    const result = await originalRender.apply(this, args);
    syncPageClass();
    return result;
  };

  syncPageClass();
})();
