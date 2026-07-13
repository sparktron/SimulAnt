/**
 * Manages saving, loading, and deleting parameter presets in localStorage.
 */

const PRESETS_KEY = 'simulantParameterPresets';

export class PresetManager {
  constructor() {
    this.presets = this.loadPresetsFromStorage();
  }

  /**
   * Load all presets from localStorage
   */
  loadPresetsFromStorage() {
    try {
      const stored = localStorage.getItem(PRESETS_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (!isPlainObject(parsed)) {
        console.warn('[SimAnt] Ignoring malformed parameter presets: expected a JSON object.');
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(([, config]) => isPlainObject(config)),
      );
    } catch (e) {
      console.warn('[SimAnt] Could not load saved parameter presets from localStorage — using defaults. Storage may be full or disabled in your browser:', e);
      return {};
    }
  }

  /**
   * Save all presets to localStorage
   */
  savePresetsToStorage() {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(this.presets));
    } catch (e) {
      console.error('[SimAnt] Could not save parameter presets to localStorage. Storage may be full or disabled in your browser:', e);
    }
  }

  /**
   * Save the current config as a named preset
   */
  savePreset(name, config) {
    if (typeof name !== 'string' || !name.trim() || !isPlainObject(config)) return false;
    this.presets[name] = { ...config };
    this.savePresetsToStorage();
    return true;
  }

  /**
   * Load a preset by name
   */
  loadPreset(name) {
    return Object.hasOwn(this.presets, name) ? { ...this.presets[name] } : null;
  }

  /**
   * Delete a preset by name
   */
  deletePreset(name) {
    delete this.presets[name];
    this.savePresetsToStorage();
  }

  /**
   * Get list of all preset names
   */
  getPresetNames() {
    return Object.keys(this.presets).sort();
  }

  /**
   * Check if a preset exists
   */
  presetExists(name) {
    return Object.hasOwn(this.presets, name);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
