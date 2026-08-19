const handlers = [];

/**
 * Register a back button interceptor.
 * When Android hardware/gesture back button is pressed, the most recently
 * registered handler (top of stack) will be called first.
 * If handler returns true, default page back-navigation is prevented.
 * 
 * @param {function} fn Handler function. Must return true if it consumed the event.
 * @return {function} Unregister function
 */
export function registerBackButtonHandler(fn) {
  handlers.push(fn);
  return () => {
    const idx = handlers.indexOf(fn);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

/**
 * Trigger back button event across registered handlers.
 * Returns true if an overlay handler consumed the event.
 */
export function dispatchBackButton() {
  for (let i = handlers.length - 1; i >= 0; i--) {
    try {
      const handled = handlers[i]();
      if (handled) return true;
    } catch (e) {
      console.warn('[BackButton] Handler error:', e);
    }
  }
  return false;
}
