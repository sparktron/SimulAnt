import { TriangleControl } from './TriangleControl.js';

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element: ${id}`);
  return el;
}

export class ColonyStatusPanel {
  constructor({ initialState, onWorkChange, onCasteChange }) {
    this.openButton = byId('colonyStatusBtn');
    this.dialog = byId('statusPanel');
    const workContainer = byId('workTriangleContainer');
    const casteContainer = byId('casteTriangleContainer');

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
