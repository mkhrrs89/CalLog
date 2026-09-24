setTimeout(() => {
  'use strict';

  if (!window.App || App.__foodSourceControlsInstalled) return;
  App.__foodSourceControlsInstalled = true;

  const addHomemadeShortcut = input => {
    if (!input || input.dataset.homemadeShortcutReady === 'true') return;
    input.dataset.homemadeShortcutReady = 'true';

    const label = input.closest('label');
    if (!label) return;

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.style.marginTop = '0.15rem';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = 'Homemade';
    button.addEventListener('click', () => {
      input.value = 'Homemade';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    });

    actions.appendChild(button);
    label.appendChild(actions);
  };

  const originalOpenFoodEditor = App.openFoodEditor;
  App.openFoodEditor = async function(id = '') {
    const result = await originalOpenFoodEditor.call(this, id);
    addHomemadeShortcut(document.getElementById('foodEditSource'));
    return result;
  };

  const originalOpenEntryEditor = App.openEntryEditor;
  App.openEntryEditor = function(id) {
    const result = originalOpenEntryEditor.call(this, id);
    const entry = this.cache.entries.find(item => item.id === id);
    const form = document.querySelector('#modalContent form');
    const noteLabel = document.getElementById('editEntryNote')?.closest('label');

    if (!entry || !form || !noteLabel || document.getElementById('editEntrySource')) {
      return result;
    }

    const label = document.createElement('label');
    label.innerHTML = `Source <span class="field-help">This logged instance only</span><input id="editEntrySource" value="${this.attr(entry.source || '')}" placeholder="Brand, restaurant, or homemade" />`;
    form.insertBefore(label, noteLabel);

    addHomemadeShortcut(document.getElementById('editEntrySource'));

    // Source is editable above now, so remove the redundant read-only Source
    // line from the informational card if it exists.
    const infoCard = form.querySelector('.card.subtle.small');
    if (infoCard) {
      [...infoCard.children].forEach(child => {
        if (child.querySelector('strong')?.textContent.trim() === 'Source:') {
          child.remove();
        }
      });
    }

    return result;
  };

  const originalSaveEntryEdit = App.saveEntryEdit;
  App.saveEntryEdit = async function(id) {
    const sourceInput = document.getElementById('editEntrySource');
    if (!sourceInput) return originalSaveEntryEdit.call(this, id);

    const source = sourceInput.value.trim();
    const db = this.db;
    const originalPut = db.put;

    // Explicitly modify only the one entry being edited. Never write this
    // instance-level source change back to the saved food in the Foods tab.
    db.put = function(storeName, value) {
      if (storeName === 'entries' && value?.id === id) {
        value = { ...value, source };
      }
      return originalPut.call(this, storeName, value);
    };

    try {
      return await originalSaveEntryEdit.call(this, id);
    } finally {
      db.put = originalPut;
    }
  };
}, 0);
