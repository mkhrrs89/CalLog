(() => {
  'use strict';

  if (!window.App || typeof App.entriesHtml !== 'function') return;

  const originalEntriesHtml = App.entriesHtml;

  App.entriesHtml = function(entries) {
    if (this.view.entryView !== 'grouped' || !entries.length) {
      return originalEntriesHtml.call(this, entries);
    }

    const tags = this.tagMap();
    const tagOrder = new Map(this.cache.tags.map((tag, index) => [tag.id, index]));
    const groups = new Map();

    for (const [entryIndex, entry] of entries.entries()) {
      const currentTag = tags.get(entry.mealTagId);
      const snapshotName = entry.mealTagSnapshot?.name;
      const name = currentTag?.name || snapshotName || 'Untagged';
      const key = entry.mealTagId
        ? `tag:${entry.mealTagId}`
        : snapshotName
          ? `snapshot:${snapshotName}`
          : 'untagged';

      if (!groups.has(key)) {
        groups.set(key, {
          name,
          tagId: currentTag?.id || '',
          items: [],
          order: currentTag
            ? (tagOrder.get(currentTag.id) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER,
          firstEntryIndex: entryIndex,
          untagged: !entry.mealTagId && !snapshotName,
        });
      }

      groups.get(key).items.push(entry);
    }

    const orderedGroups = [...groups.values()].sort((a, b) => {
      if (a.untagged !== b.untagged) return a.untagged ? 1 : -1;
      if (a.order !== b.order) return a.order - b.order;
      return a.firstEntryIndex - b.firstEntryIndex;
    });

    return orderedGroups.map(({ name, tagId, items }) => {
      const groupTotal = items.reduce(
        (sum, entry) => sum + Number(entry.calories || 0),
        0
      );
      const dropAttributes = tagId
        ? ` data-meal-tag-id="${this.attr(tagId)}" data-meal-tag-name="${this.attr(name)}"`
        : '';

      return `
        <section class="meal-tag-group"${dropAttributes}>
          <div class="group-head">
            <span>${this.esc(name)}</span>
            <span class="group-total">${this.formatNumber(groupTotal)} cal</span>
          </div>
          <div class="entry-list">${items.map(entry => this.entryRowHtml(entry, tags)).join('')}</div>
        </section>`;
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
