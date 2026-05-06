import { parameterDefinitions, getParametersByGroup, getDefaultConfig } from './params.js';
import { PresetManager } from './PresetManager.js';

/**
 * Parameter editor UI component.
 * Renders collapsible parameter groups with sliders.
 */
export class ParameterEditor {
  constructor(containerSelector, state, onConfigChange) {
    this.container = document.querySelector(containerSelector);
    this.state = state;
    this.onConfigChange = onConfigChange;
    this.presetManager = new PresetManager();
    this.advancedMode = false;
    this.expandedGroups = new Set();
    this.defaults = getDefaultConfig();

    if (!this.container) {
      throw new Error(`Container "${containerSelector}" not found`);
    }

    this.render();
    this.attachEventListeners();
  }

  render() {
    this.container.innerHTML = '';
    this.container.className = 'parameter-editor';

    // Preset controls
    this.renderPresetControls();

    // Advanced toggle
    this.renderAdvancedToggle();

    // Parameter groups
    this.renderParameterGroups();
  }

  renderPresetControls() {
    const presetDiv = document.createElement('div');
    presetDiv.className = 'preset-controls';

    const label = document.createElement('label');
    label.textContent = 'Presets:';

    const select = document.createElement('select');
    select.id = 'presetSelect';
    select.innerHTML = '<option value="">-- Select preset --</option>';

    const presets = this.presetManager.getPresetNames();
    presets.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    select.addEventListener('change', e => {
      if (e.target.value) {
        this.loadPreset(e.target.value);
      }
    });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => this.showSavePresetDialog());

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      const selected = select.value;
      if (selected) {
        this.presetManager.deletePreset(selected);
        this.render();
      }
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.className = 'reset-btn';
    resetBtn.addEventListener('click', () => this.resetToDefaults());

    presetDiv.appendChild(label);
    presetDiv.appendChild(select);
    presetDiv.appendChild(saveBtn);
    presetDiv.appendChild(deleteBtn);
    presetDiv.appendChild(resetBtn);

    this.container.appendChild(presetDiv);
  }

  renderAdvancedToggle() {
    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'advanced-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'advancedToggle';
    checkbox.checked = this.advancedMode;
    checkbox.addEventListener('change', e => {
      this.advancedMode = e.target.checked;
      this.render();
    });

    const label = document.createElement('label');
    label.htmlFor = 'advancedToggle';
    label.textContent = 'Advanced Parameters';

    toggleDiv.appendChild(checkbox);
    toggleDiv.appendChild(label);

    this.container.appendChild(toggleDiv);
  }

  renderParameterGroups() {
    const grouped = getParametersByGroup(this.advancedMode);
    const groupOrder = [
      'Movement',
      'Decision-Making',
      'Obstacle Avoidance',
      'Health',
      'Nest Behavior',
      'Pheromone',
      'Queen',
      'Population',
    ];

    groupOrder.forEach(group => {
      if (!grouped[group]) return;

      const groupDiv = document.createElement('div');
      groupDiv.className = 'parameter-group';

      const header = document.createElement('div');
      header.className = 'group-header';
      header.addEventListener('click', () => this.toggleGroup(group));

      const arrow = document.createElement('span');
      arrow.className = 'expand-arrow';
      arrow.textContent = this.expandedGroups.has(group) ? '▼' : '▶';

      const title = document.createElement('span');
      title.className = 'group-title';
      title.textContent = group;

      header.appendChild(arrow);
      header.appendChild(title);
      groupDiv.appendChild(header);

      if (this.expandedGroups.has(group)) {
        const content = document.createElement('div');
        content.className = 'group-content';

        grouped[group].forEach(param => {
          content.appendChild(this.renderParameter(param));
        });

        groupDiv.appendChild(content);
      }

      this.container.appendChild(groupDiv);
    });
  }

  renderParameter(param) {
    const paramDiv = document.createElement('div');
    paramDiv.className = 'parameter-item';

    // Label with help icon
    const labelContainer = document.createElement('div');
    labelContainer.className = 'param-label-container';

    const label = document.createElement('label');
    label.className = 'param-label';
    label.textContent = param.label;

    // Add help icon if description exists
    if (param.description) {
      const helpIcon = document.createElement('span');
      helpIcon.className = 'param-help-icon';
      helpIcon.textContent = '?';
      helpIcon.title = param.description;
      labelContainer.appendChild(label);
      labelContainer.appendChild(helpIcon);
    } else {
      labelContainer.appendChild(label);
    }

    const inputContainer = document.createElement('div');
    inputContainer.className = 'param-input-container';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = param.min;
    slider.max = param.max;
    slider.step = param.step;
    slider.value = this.state.config[param.key] ?? param.min;
    slider.className = 'param-slider';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = param.min;
    input.max = param.max;
    input.step = param.step;
    input.value = this.state.config[param.key] ?? param.min;
    input.className = 'param-input';

    const updateValue = value => {
      const rawValue = String(value).trim();
      const numVal = rawValue === '' ? NaN : Number(rawValue);
      if (!Number.isFinite(numVal)) {
        const currentValue = Number.isFinite(this.state.config[param.key])
          ? this.state.config[param.key]
          : param.min;
        slider.value = currentValue;
        input.value = currentValue;
        return;
      }

      const clamped = Math.max(param.min, Math.min(param.max, numVal));
      this.state.config[param.key] = clamped;
      slider.value = clamped;
      input.value = clamped;
      if (this.onConfigChange) {
        this.onConfigChange();
      }
    };

    slider.addEventListener('input', e => updateValue(e.target.value));
    input.addEventListener('input', e => updateValue(e.target.value));
    input.addEventListener('blur', e => updateValue(e.target.value));

    inputContainer.appendChild(slider);
    inputContainer.appendChild(input);

    paramDiv.appendChild(labelContainer);
    paramDiv.appendChild(inputContainer);

    return paramDiv;
  }

  toggleGroup(groupName) {
    if (this.expandedGroups.has(groupName)) {
      this.expandedGroups.delete(groupName);
    } else {
      this.expandedGroups.add(groupName);
    }
    this.render();
  }

  showSavePresetDialog() {
    const name = prompt('Preset name:');
    if (name && name.trim()) {
      this.presetManager.savePreset(name.trim(), this.state.config);
      this.render();
    }
  }

  loadPreset(name) {
    const config = this.presetManager.loadPreset(name);
    if (config) {
      // Only update the parameters we have definitions for
      Object.keys(config).forEach(key => {
        if (parameterDefinitions[key]) {
          this.state.config[key] = config[key];
        }
      });
      if (this.onConfigChange) {
        this.onConfigChange();
      }
      // Re-render to update all sliders and inputs
      this.render();
      // Reset the select
      document.getElementById('presetSelect').value = '';
    }
  }

  resetToDefaults() {
    if (confirm('Reset all parameters to defaults?')) {
      Object.keys(this.defaults).forEach(key => {
        if (key in this.state.config) {
          this.state.config[key] = this.defaults[key];
        }
      });
      if (this.onConfigChange) {
        this.onConfigChange();
      }
      // Re-render to update all sliders and inputs
      this.render();
    }
  }

  attachEventListeners() {
    // Initial expand of first groups for better UX
    if (this.expandedGroups.size === 0) {
      this.expandedGroups.add('Movement');
      this.expandedGroups.add('Decision-Making');
    }
  }
}
