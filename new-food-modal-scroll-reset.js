setTimeout(() => {
  'use strict';

  if (!window.App || App.__newFoodModalScrollResetInstalled) return;
  App.__newFoodModalScrollResetInstalled = true;

  const originalOpenFoodEditor = App.openFoodEditor;

  App.openFoodEditor = async function(id = '') {
    const shouldResetToTop = !id && this.view?.page === 'foods';
    const result = await originalOpenFoodEditor.call(this, id);

    if (!shouldResetToTop) return result;

    const resetToTop = () => {
      const modal = document.getElementById('modal');
      const content = document.getElementById('modalContent');

      if (modal) {
        modal.scrollTop = 0;
        if (typeof modal.scrollTo === 'function') {
          modal.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
      }

      if (content) {
        content.scrollTop = 0;
        if (typeof content.scrollTo === 'function') {
          content.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
      }
    };

    // Reset immediately and again after layout settles so iOS cannot restore a
    // previous modal scroll position after the editor's enhancement fields load.
    resetToTop();
    requestAnimationFrame(() => {
      resetToTop();
      requestAnimationFrame(resetToTop);
    });

    return result;
  };
}, 0);
