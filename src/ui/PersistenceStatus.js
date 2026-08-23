const VALID_LEVELS = new Set(['success', 'notice', 'error']);

/**
 * Shows the latest save/load result in the persistent aria-live region.
 *
 * @param {HTMLElement} region
 * @param {string} message
 * @param {'success'|'notice'|'error'} [level]
 */
export function showPersistenceStatus(region, message, level = 'success') {
  if (!region) throw new Error('Persistence status region is required');

  region.textContent = String(message);
  region.dataset.level = VALID_LEVELS.has(level) ? level : 'notice';
}
