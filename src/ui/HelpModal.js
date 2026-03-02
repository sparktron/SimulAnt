export class HelpModal {
  constructor(id = 'helpPanel') {
    this.el = document.getElementById(id);
    const close = document.getElementById('closeHelpBtn');
    if (close) close.addEventListener('click', () => this.close());
  }

  toggle() {
    if (!this.el) return;
    if (this.el.open) this.el.close();
    else this.el.showModal();
  }

  close() {
    if (this.el?.open) this.el.close();
  }
}
