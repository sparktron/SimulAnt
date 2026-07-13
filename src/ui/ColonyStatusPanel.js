import { TriangleControl } from './TriangleControl.js';

function byId(id) {
  return document.getElementById(id);
}

export class ColonyStatusPanel {
  constructor({ initialState, onWorkChange, onCasteChange }) {
    this.enabled = false;

    this.openButton = byId('colonyStatusBtn');
    this.dialog = byId('statusPanel');
    this.closeButton = byId('closeStatusBtn');
    const workContainer = byId('workTriangleContainer');
    const casteContainer = byId('casteTriangleContainer');

    const missing = [
      ['colonyStatusBtn', this.openButton],
      ['statusPanel', this.dialog],
      ['closeStatusBtn', this.closeButton],
      ['workTriangleContainer', workContainer],
      ['casteTriangleContainer', casteContainer],
    ]
      .filter(([, element]) => !element)
      .map(([id]) => id);

    if (missing.length > 0) {
      console.warn(
        `[SimAnt] Colony Status panel is disabled because these required DOM elements are missing from index.html: ${missing.join(', ')}. `
        + 'The simulation will still run, but the work/caste allocation triangles will not appear.',
      );
      return;
    }

    this.enabled = true;
    this.openButton.setAttribute('aria-haspopup', 'dialog');
    this.openButton.setAttribute('aria-controls', 'statusPanel');

    this.workTriangle = new TriangleControl({
      container: workContainer,
      title: 'WORK ALLOCATION',
      labels: ['Forage', 'Dig', 'Nurse'],
      initialWeights: initialState.work,
      onChange: ({ percentages }) => onWorkChange(percentages),
    });

    this.casteTriangle = new TriangleControl({
      container: casteContainer,
      title: 'CASTE ALLOCATION',
      labels: ['Workers', 'Soldiers', 'Breeders'],
      initialWeights: initialState.caste,
      onChange: ({ percentages }) => onCasteChange(percentages),
    });

    this.openButton.addEventListener('click', () => {
      if (this.dialog.open) this.dialog.close();
      else this.dialog.showModal();
    });
    this.closeButton.addEventListener('click', () => this.dialog.close());

    this.dialog.addEventListener('click', (event) => {
      const rect = this.dialog.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) this.dialog.close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.dialog.open) this.dialog.close();
    });
  }

  sync(state) {
    if (!this.enabled) return;
    this.workTriangle.setWeights({
      wA: state.work.forage / 100,
      wB: state.work.dig / 100,
      wC: state.work.nurse / 100,
    });
    this.casteTriangle.setWeights({
      wA: state.caste.workers / 100,
      wB: state.caste.soldiers / 100,
      wC: state.caste.breeders / 100,
    });
  }
}
