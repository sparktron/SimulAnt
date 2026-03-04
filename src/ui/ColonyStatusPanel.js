import { TriangleControl } from './TriangleControl.js';

export class ColonyStatusPanel {
  constructor(options) {
    this.dialog = options.dialog;
    this.mountNode = options.mountNode;
    this.onWorkChange = options.onWorkChange;
    this.onCasteChange = options.onCasteChange;

    this.triangles = [];
    this.#build(options.initialWork, options.initialCaste);

    this.dialog.addEventListener('click', (event) => {
      const panel = this.dialog.querySelector('.status-panel');
      if (!panel.contains(event.target)) this.close();
    });
  }

  #build(initialWork, initialCaste) {
    this.mountNode.innerHTML = '';

    this.triangles.push(new TriangleControl(this.mountNode, {
      title: 'COLONY WORK ALLOCATION',
      corners: ['Forage', 'Dig', 'Nurse'],
      initialWeights: {
        a: initialWork.Forage / 100,
        b: initialWork.Dig / 100,
        c: initialWork.Nurse / 100,
      },
      onChange: this.onWorkChange,
    }));

    this.triangles.push(new TriangleControl(this.mountNode, {
      title: 'HATCHING CASTE PRIORITY',
      corners: ['Workers', 'Soldiers', 'Breeders'],
      initialWeights: {
        a: initialCaste.Workers / 100,
        b: initialCaste.Soldiers / 100,
        c: initialCaste.Breeders / 100,
      },
      onChange: this.onCasteChange,
    }));
  }

  toggle() {
    if (this.dialog.open) this.close();
    else this.open();
  }

  open() {
    this.dialog.showModal();
  }

  close() {
    this.dialog.close();
  }
}
