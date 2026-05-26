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
      return stored ? JSON.parse(stored) : {};
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
    this.presets[name] = { ...config };
    this.savePresetsToStorage();
  }

  /**
   * Load a preset by name
   */
  loadPreset(name) {
    return this.presets[name] ? { ...this.presets[name] } : null;
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
    return name in this.presets;
  }
}
