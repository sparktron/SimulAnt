import { TriangleControl } from './TriangleControl.js';

export class ColonyStatusPanel {
  constructor(options) {
    this.dialog = options.dialog;
    this.mountNode = options.mountNode;
    this.onWorkChange = options.onWorkChange;
    this.onCasteChange = options.onCasteChange;

    this.triangles = [];
    this.#build(options.initialWork, options.initialCaste);

    this.hasNativeDialog = typeof this.dialog.showModal === 'function' && typeof this.dialog.close === 'function';

    this.dialog.addEventListener('click', (event) => {
      if (!this.isOpen()) return;
      const panel = this.dialog.querySelector('.status-panel');
      const clickedBackdrop = event.target === this.dialog;
      if (clickedBackdrop && panel) this.close();
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

  isOpen() {
    return Boolean(this.dialog.open || this.dialog.classList.contains('is-open'));
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open() {
    if (this.hasNativeDialog) {
      if (!this.dialog.open) this.dialog.showModal();
      return;
    }
    this.dialog.classList.add('is-open');
    this.dialog.setAttribute('open', 'open');
  }

  close() {
    if (this.hasNativeDialog) {
      if (this.dialog.open) this.dialog.close();
      return;
    }
    this.dialog.classList.remove('is-open');
    this.dialog.removeAttribute('open');
  }
}
