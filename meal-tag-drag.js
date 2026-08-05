(() => {
  'use strict';

  if (!window.App || App.__mealTagDragInstalled) return;
  App.__mealTagDragInstalled = true;

  const MOUSE_DRAG_SLOP = 6;
  const TOUCH_CANCEL_SLOP = 10;
  const TOUCH_HOLD_MS = 300;
  const EDGE_SCROLL_ZONE = 74;
  const MAX_SCROLL_SPEED = 18;

  let candidate = null;
  let activeDrag = null;
  let holdTimer = 0;
  let suppressClickUntil = 0;
  let scrollFrame = 0;
  let scrollSpeed = 0;
  let lastPoint = null;

  const clearHoldTimer = () => {
    window.clearTimeout(holdTimer);
    holdTimer = 0;
  };

  const entryForWrapper = wrapper => {
    const id = wrapper?.dataset.entryId || '';
    return App.cache.entries.find(entry => entry.id === id) || null;
  };

  const alternateVisibleTargets = sourceTagId => [
    ...document.querySelectorAll('.meal-tag-group[data-meal-tag-id]'),
  ].filter(group => group.dataset.mealTagId !== sourceTagId);

  const clearTarget = () => {
    activeDrag?.target?.classList.remove('is-meal-drop-target');
    if (activeDrag) activeDrag.target = null;
  };

  const targetAtPoint = (x, y) => {
    const group = document.elementFromPoint(x, y)?.closest('.meal-tag-group[data-meal-tag-id]');
    if (!group || !activeDrag) return null;
    if (group.dataset.mealTagId === activeDrag.sourceTagId) return null;
    return App.cache.tags.some(tag => tag.id === group.dataset.mealTagId) ? group : null;
  };

  const updateTarget = (x, y) => {
    if (!activeDrag) return;
    const nextTarget = targetAtPoint(x, y);
    if (nextTarget === activeDrag.target) return;
    clearTarget();
    activeDrag.target = nextTarget;
    nextTarget?.classList.add('is-meal-drop-target');
  };

  const moveGhost = (x, y) => {
    if (!activeDrag?.ghost) return;
    activeDrag.ghost.style.left = `${x - activeDrag.offsetX}px`;
    activeDrag.ghost.style.top = `${y - activeDrag.offsetY}px`;
  };

  const stopAutoScroll = () => {
    scrollSpeed = 0;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  };

  const autoScrollStep = () => {
    scrollFrame = 0;
    if (!activeDrag || !scrollSpeed) return;
    window.scrollBy(0, scrollSpeed);
    if (lastPoint) updateTarget(lastPoint.x, lastPoint.y);
    scrollFrame = requestAnimationFrame(autoScrollStep);
  };

  const updateAutoScroll = y => {
    if (y < EDGE_SCROLL_ZONE) {
      scrollSpeed = -Math.max(4, Math.round((EDGE_SCROLL_ZONE - y) / EDGE_SCROLL_ZONE * MAX_SCROLL_SPEED));
    } else if (y > window.innerHeight - EDGE_SCROLL_ZONE) {
      scrollSpeed = Math.max(4, Math.round((y - (window.innerHeight - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE * MAX_SCROLL_SPEED));
    } else {
      scrollSpeed = 0;
    }

    if (scrollSpeed && !scrollFrame) scrollFrame = requestAnimationFrame(autoScrollStep);
    if (!scrollSpeed && scrollFrame) stopAutoScroll();
  };

  const closeOpenSwipeRows = () => {
    document.querySelectorAll('.swipe-entry.is-open').forEach(wrapper => {
      wrapper.classList.remove('is-open', 'is-dragging');
      const track = wrapper.querySelector('.swipe-entry-track');
      const action = wrapper.querySelector('.swipe-delete-action');
      if (track) track.style.transform = '';
      if (action) {
        action.tabIndex = -1;
        action.setAttribute('aria-hidden', 'true');
      }
    });
  };

  const startDrag = pending => {
    if (!pending || candidate !== pending || activeDrag) return false;
    if (!pending.wrapper.isConnected || App.view.entryView !== 'grouped' || App.view.page !== 'today') return false;

    const entry = entryForWrapper(pending.wrapper);
    if (!entry) return false;

    if (!alternateVisibleTargets(entry.mealTagId || '').length) {
      candidate = null;
      clearHoldTimer();
      App.showToast('Another visible meal tag is needed for dragging');
      return false;
    }

    closeOpenSwipeRows();
    clearHoldTimer();

    const row = pending.wrapper.querySelector('.entry-row');
    const rect = row?.getBoundingClientRect();
    if (!row || !rect) return false;

    const ghost = row.cloneNode(true);
    ghost.classList.add('meal-tag-drag-ghost');
    ghost.removeAttribute('onclick');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);

    activeDrag = {
      pointerId: pending.pointerId,
      pointerType: pending.pointerType,
      wrapper: pending.wrapper,
      track: pending.track,
      sourceGroup: pending.sourceGroup,
      sourceTagId: entry.mealTagId || '',
      entryId: entry.id,
      ghost,
      target: null,
      offsetX: Math.max(0, Math.min(rect.width, pending.lastX - rect.left)),
      offsetY: Math.max(0, Math.min(rect.height, pending.lastY - rect.top)),
    };

    candidate = null;
    App.__mealTagDragActivePointerId = pending.pointerId;
    pending.wrapper.classList.add('is-meal-drag-source');
    pending.sourceGroup?.classList.add('is-meal-drag-source-group');
    document.body.classList.add('meal-tag-dragging');
    document.documentElement.style.cursor = 'grabbing';

    try { pending.track.setPointerCapture(pending.pointerId); } catch (_) {}
    if (pending.pointerType !== 'mouse' && navigator.vibrate) navigator.vibrate(18);

    moveGhost(pending.lastX, pending.lastY);
    updateTarget(pending.lastX, pending.lastY);
    return true;
  };

  const cancelCandidate = () => {
    clearHoldTimer();
    candidate = null;
  };

  const cleanupDrag = ({ suppressClick = true } = {}) => {
    clearHoldTimer();
    stopAutoScroll();
    clearTarget();

    if (activeDrag) {
      try { activeDrag.track.releasePointerCapture(activeDrag.pointerId); } catch (_) {}
      activeDrag.wrapper.classList.remove('is-meal-drag-source');
      activeDrag.sourceGroup?.classList.remove('is-meal-drag-source-group');
      activeDrag.ghost?.remove();
    }

    document.body.classList.remove('meal-tag-dragging');
    document.documentElement.style.cursor = '';
    App.__mealTagDragActivePointerId = null;
    activeDrag = null;
    candidate = null;
    lastPoint = null;

    if (suppressClick) {
      suppressClickUntil = Date.now() + 520;
      App.__mealTagDragSuppressClickUntil = suppressClickUntil;
    }
  };

  App.moveEntryToMealTag = async function(entryId, mealTagId) {
    const entry = this.cache.entries.find(item => item.id === entryId);
    const tag = this.cache.tags.find(item => item.id === mealTagId);
    if (!entry || !tag || entry.mealTagId === tag.id) return;

    await this.db.put('entries', {
      ...entry,
      mealTagId: tag.id,
      mealTagSnapshot: { id: tag.id, name: tag.name, color: tag.color },
      updatedAt: new Date().toISOString(),
    });
    await this.refreshCache();
    await this.render();
    this.showToast(`${entry.name || 'Entry'} moved to ${tag.name}`);
  };

  document.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button > 0 || activeDrag) return;
    if (App.view.page !== 'today' || App.view.entryView !== 'grouped') return;
    if (event.target.closest('.swipe-delete-action, input, select, textarea, a')) return;

    const wrapper = event.target.closest('.meal-tag-group .swipe-entry[data-entry-id]');
    const track = wrapper?.querySelector('.swipe-entry-track');
    const sourceGroup = wrapper?.closest('.meal-tag-group');
    if (!wrapper || !track || !sourceGroup) return;

    candidate = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      wrapper,
      track,
      sourceGroup,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };

    if (candidate.pointerType !== 'mouse') {
      holdTimer = window.setTimeout(() => startDrag(candidate), TOUCH_HOLD_MS);
    }
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      event.preventDefault();
      lastPoint = { x: event.clientX, y: event.clientY };
      moveGhost(event.clientX, event.clientY);
      updateTarget(event.clientX, event.clientY);
      updateAutoScroll(event.clientY);
      return;
    }

    if (!candidate || event.pointerId !== candidate.pointerId) return;
    candidate.lastX = event.clientX;
    candidate.lastY = event.clientY;
    const dx = event.clientX - candidate.startX;
    const dy = event.clientY - candidate.startY;
    const distance = Math.hypot(dx, dy);

    if (candidate.pointerType === 'mouse') {
      if (distance >= MOUSE_DRAG_SLOP && startDrag(candidate)) {
        event.preventDefault();
        lastPoint = { x: event.clientX, y: event.clientY };
        moveGhost(event.clientX, event.clientY);
        updateTarget(event.clientX, event.clientY);
        updateAutoScroll(event.clientY);
      }
      return;
    }

    if (distance >= TOUCH_CANCEL_SLOP) cancelCandidate();
  }, { passive: false });

  document.addEventListener('pointerup', event => {
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      event.preventDefault();
      const entryId = activeDrag.entryId;
      const targetTagId = activeDrag.target?.dataset.mealTagId || '';
      cleanupDrag({ suppressClick: true });
      if (targetTagId) App.moveEntryToMealTag(entryId, targetTagId);
      return;
    }

    if (candidate && event.pointerId === candidate.pointerId) cancelCandidate();
  }, { passive: false });

  document.addEventListener('pointercancel', event => {
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      cleanupDrag({ suppressClick: true });
      return;
    }
    if (candidate && event.pointerId === candidate.pointerId) cancelCandidate();
  }, { passive: true });

  document.addEventListener('click', event => {
    if (Date.now() >= suppressClickUntil) return;
    if (!event.target.closest('.swipe-entry, .entry-row')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeDrag) cleanupDrag({ suppressClick: true });
  });
})();
