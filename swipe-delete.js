(() => {
  'use strict';

  if (App.__swipeDeleteInstalled) return;
  App.__swipeDeleteInstalled = true;

  const OPEN_DISTANCE = 92;
  const DRAG_SLOP = 7;
  const HORIZONTAL_BIAS = 1.08;
  const DELETE_TAP_SLOP = 12;
  let gesture = null;
  let deleteTap = null;
  let openWrapper = null;
  let suppressClickUntil = 0;

  const originalEntryRowHtml = App.entryRowHtml;
  App.entryRowHtml = function(entry, tags) {
    const rowHtml = originalEntryRowHtml.call(this, entry, tags);
    const id = this.attr(entry.id);
    const name = this.attr(entry.name || 'entry');

    return `
      <div class="swipe-entry" data-entry-id="${id}">
        <button
          class="swipe-delete-action"
          type="button"
          data-entry-id="${id}"
          aria-label="Delete ${name}"
          aria-hidden="true"
          tabindex="-1"
        >
          <span aria-hidden="true">Delete</span>
        </button>
        <div class="swipe-entry-track">${rowHtml}</div>
      </div>`;
  };

  const actionFor = wrapper => wrapper?.querySelector('.swipe-delete-action');
  const trackFor = wrapper => wrapper?.querySelector('.swipe-entry-track');

  const setActionAccessibility = (wrapper, visible) => {
    const action = actionFor(wrapper);
    if (!action) return;
    action.tabIndex = visible ? 0 : -1;
    action.setAttribute('aria-hidden', visible ? 'false' : 'true');
  };

  const closeEntry = (wrapper = openWrapper, animate = true) => {
    if (!wrapper) return;
    const track = trackFor(wrapper);
    if (!track) return;

    if (!animate) track.style.transition = 'none';
    wrapper.classList.remove('is-open', 'is-dragging');
    track.style.transform = '';
    setActionAccessibility(wrapper, false);

    if (!animate) {
      requestAnimationFrame(() => {
        if (track.isConnected) track.style.transition = '';
      });
    }

    if (openWrapper === wrapper) openWrapper = null;
  };

  const openEntry = wrapper => {
    if (!wrapper) return;
    if (openWrapper && openWrapper !== wrapper) closeEntry(openWrapper);

    const track = trackFor(wrapper);
    if (!track) return;
    track.style.transform = '';
    wrapper.classList.remove('is-dragging');
    wrapper.classList.add('is-open');
    setActionAccessibility(wrapper, true);
    openWrapper = wrapper;
  };

  const deleteFromAction = async deleteButton => {
    const wrapper = deleteButton?.closest('.swipe-entry');
    const id = deleteButton?.dataset.entryId;
    if (!wrapper || !id || wrapper.classList.contains('is-deleting')) return false;

    wrapper.classList.add('is-deleting');
    openWrapper = null;
    await new Promise(resolve => window.setTimeout(resolve, 190));
    await App.deleteEntryImmediate(id);
    return true;
  };

  const clampDrag = value => {
    if (value > 0) return Math.min(14, value * 0.22);
    if (value < -OPEN_DISTANCE) {
      return -OPEN_DISTANCE + ((value + OPEN_DISTANCE) * 0.18);
    }
    return value;
  };

  const cancelSwipeForMealDrag = pointerId => {
    if (!gesture || gesture.pointerId !== pointerId) return;
    const canceled = gesture;
    gesture = null;
    try { canceled.track.releasePointerCapture(pointerId); } catch (_) {}
    canceled.wrapper.classList.remove('is-dragging');
    canceled.track.style.transform = '';
  };

  document.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button > 0) return;

    const deleteButton = event.target.closest('.swipe-delete-action');
    if (deleteButton && event.pointerType !== 'mouse') {
      deleteTap = {
        pointerId: event.pointerId,
        button: deleteButton,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      gesture = null;
      return;
    }

    // Swipe-to-delete is a touch/pen gesture. Mouse input should remain a
    // normal click so desktop users can always open the entry editor.
    if (event.pointerType === 'mouse') {
      gesture = null;
      suppressClickUntil = 0;
      return;
    }

    const track = event.target.closest('.swipe-entry-track');
    if (!track) return;
    const wrapper = track.closest('.swipe-entry');
    if (!wrapper) return;

    if (openWrapper && !openWrapper.isConnected) openWrapper = null;
    if (openWrapper && openWrapper !== wrapper) closeEntry(openWrapper);

    gesture = {
      pointerId: event.pointerId,
      wrapper,
      track,
      startX: event.clientX,
      startY: event.clientY,
      baseX: wrapper.classList.contains('is-open') ? -OPEN_DISTANCE : 0,
      currentX: wrapper.classList.contains('is-open') ? -OPEN_DISTANCE : 0,
      axis: null,
      moved: false,
    };

    try { track.setPointerCapture(event.pointerId); } catch (_) {}
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (deleteTap && event.pointerId === deleteTap.pointerId) {
      const dx = event.clientX - deleteTap.startX;
      const dy = event.clientY - deleteTap.startY;
      if (Math.hypot(dx, dy) > DELETE_TAP_SLOP) deleteTap.moved = true;
      return;
    }

    if (App.__mealTagDragActivePointerId === event.pointerId) {
      cancelSwipeForMealDrag(event.pointerId);
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (!gesture.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS ? 'x' : 'y';
    }

    if (gesture.axis !== 'x') return;

    event.preventDefault();
    gesture.moved = true;
    gesture.currentX = clampDrag(gesture.baseX + dx);
    gesture.wrapper.classList.add('is-dragging');
    gesture.track.style.transform = `translate3d(${gesture.currentX}px, 0, 0)`;
  }, { passive: false });

  const finishGesture = event => {
    if (App.__mealTagDragActivePointerId === event.pointerId) {
      cancelSwipeForMealDrag(event.pointerId);
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const finished = gesture;
    gesture = null;

    try { finished.track.releasePointerCapture(event.pointerId); } catch (_) {}

    if (finished.axis !== 'x') return;
    finished.wrapper.classList.remove('is-dragging');
    finished.track.style.transform = '';

    if (finished.moved) suppressClickUntil = Date.now() + 420;

    if (finished.currentX <= -(OPEN_DISTANCE * 0.48)) {
      openEntry(finished.wrapper);
    } else {
      closeEntry(finished.wrapper);
    }
  };

  document.addEventListener('pointerup', event => {
    if (deleteTap && event.pointerId === deleteTap.pointerId) {
      const finished = deleteTap;
      deleteTap = null;

      const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.swipe-delete-action');
      if (!finished.moved && hit === finished.button) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteFromAction(finished.button);
      }
      return;
    }

    finishGesture(event);
  }, { passive: false });

  document.addEventListener('pointercancel', event => {
    if (deleteTap && event.pointerId === deleteTap.pointerId) deleteTap = null;
    finishGesture(event);
  }, { passive: true });

  document.addEventListener('click', async event => {
    const deleteButton = event.target.closest('.swipe-delete-action');
    if (deleteButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await deleteFromAction(deleteButton);
      return;
    }

    const row = event.target.closest('.entry-row');
    if (row) {
      const wrapper = row.closest('.swipe-entry');
      if (Date.now() < suppressClickUntil || wrapper?.classList.contains('is-open')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (wrapper?.classList.contains('is-open')) closeEntry(wrapper);
      }
      return;
    }

    if (openWrapper && !event.target.closest('.swipe-entry')) closeEntry(openWrapper);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openWrapper) closeEntry(openWrapper);
  });
})();
