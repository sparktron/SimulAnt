import { TriangleControl } from './TriangleControl.js';

export function supportsNativeDialog(dialog) {
  return Boolean(dialog && typeof dialog.showModal === 'function' && typeof dialog.close === 'function');
}

export function tryOpenNativeDialog(dialog) {
  if (!supportsNativeDialog(dialog)) return false;

  try {
    if (!dialog.open) dialog.showModal();
  } catch {
    return false;
  }

  return Boolean(dialog.open);
}

export class ColonyStatusPanel {
  constructor(options) {
    this.dialog = options.dialog;
    this.mountNode = options.mountNode;
    this.onWorkChange = options.onWorkChange;
    this.onCasteChange = options.onCasteChange;

    this.triangles = [];
    this.#build(options.initialWork, options.initialCaste);

    this.hasNativeDialog = supportsNativeDialog(this.dialog);

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
    if (this.hasNativeDialog && tryOpenNativeDialog(this.dialog)) return;
    this.dialog.classList.add('is-open');
    this.dialog.setAttribute('open', 'open');
  }

  close() {
    if (this.hasNativeDialog) {
      try {
        if (this.dialog.open) this.dialog.close();
      } catch {
        // fall through to non-native close path
      }
    }
    this.dialog.classList.remove('is-open');
    this.dialog.removeAttribute('open');
  }
}
