(() => {
  'use strict';

  if (!window.App || typeof App.entriesHtml !== 'function') return;

  const originalEntriesHtml = App.entriesHtml;

  App.entriesHtml = function(entries) {
    if (this.view.entryView !== 'grouped' || !entries.length) {
      return originalEntriesHtml.call(this, entries);
    }

    const tags = this.tagMap();
    const groups = new Map();

    for (const entry of entries) {
      const currentTag = tags.get(entry.mealTagId);
      const name = currentTag?.name || entry.mealTagSnapshot?.name || 'Untagged';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    }

    return [...groups.entries()].map(([name, items]) => {
      const groupTotal = items.reduce(
        (sum, entry) => sum + Number(entry.calories || 0),
        0
      );

      return `
        <div class="group-head">
          <span>${this.esc(name)}</span>
          <span class="group-total">${this.formatNumber(groupTotal)} cal</span>
        </div>
        <div class="entry-list">${items.map(entry => this.entryRowHtml(entry, tags)).join('')}</div>`;
    }).join('');
  };

  const style = document.createElement('style');
  style.textContent = `
    .group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .group-head .group-total {
      flex: 0 0 auto;
      white-space: nowrap;
      text-transform: none;
      font-variant-numeric: tabular-nums;
    }
  `;
  document.head.appendChild(style);
})();
