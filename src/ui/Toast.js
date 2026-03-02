export class Toast {
  constructor(containerId = 'toastContainer') {
    this.container = document.getElementById(containerId);
  }

  show(message, ms = 1400) {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    this.container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, ms);
  }
}
