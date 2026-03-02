import { VIEW } from './ViewManager.js';

export function createLeftToolbar({ state, viewManager, actions, toast }) {
  const root = document.getElementById('leftToolbarButtons');
  if (!root) throw new Error('Missing leftToolbarButtons');

  const buttons = [
    { id: 'map', icon: 'MAP', key: 'm', tooltip: 'Toggle minimap (surface only)', enabled: () => viewManager.getCurrent() === VIEW.SURFACE, onClick: () => actions.toggleMinimap() },
    { id: 'help', icon: '?', key: 'h', tooltip: 'Help', enabled: () => true, onClick: () => actions.toggleHelp() },
    { id: 'editor', icon: '⛏+💧', key: 'e', tooltip: 'Map editor', enabled: () => true, onClick: () => actions.toggleEditor() },
    { id: 'surface', icon: 'SUR', key: '1', tooltip: 'Surface view', enabled: () => true, onClick: () => viewManager.setView(VIEW.SURFACE) },
    { id: 'redNest', icon: 'RED', tooltip: 'Red nest', enabled: () => true, onClick: () => { viewManager.setView(VIEW.RED_NEST); toast.show('Red colony not implemented'); } },
    { id: 'blackNest', icon: 'BLK', key: '2', tooltip: 'Black nest', enabled: () => true, onClick: () => viewManager.setView(viewManager.getCurrent() === VIEW.BLACK_NEST ? VIEW.SURFACE : VIEW.BLACK_NEST) },
    { id: 'yellowAnt', icon: '🐜', tooltip: 'Center selected ant', enabled: () => true, onClick: () => actions.centerSelectedAnt() },
    { id: 'blackQueen', icon: 'BQ', tooltip: 'Center black queen', enabled: () => true, onClick: () => actions.centerBlackQueen() },
    { id: 'redQueen', icon: 'RQ', tooltip: 'Center red queen', enabled: () => true, onClick: () => toast.show('Red queen not implemented') },
    { id: 'pause', icon: 'PAUSE', key: 'p', tooltip: 'Pause/resume', enabled: () => true, onClick: () => actions.togglePause() },
    { id: 'scent', icon: 'SCENT', key: 'v', tooltip: 'Toggle scent overlay (surface only)', enabled: () => viewManager.getCurrent() === VIEW.SURFACE, onClick: () => actions.toggleScent() },
  ];

  const buttonEls = new Map();
  for (const def of buttons) {
    const btn = document.createElement('button');
    btn.className = 'palette-btn left-tool';
    btn.textContent = def.icon;
    btn.title = def.tooltip;
    btn.addEventListener('click', () => {
      if (!def.enabled()) return toast.show('Surface only');
      def.onClick();
      refresh();
    });
    root.appendChild(btn);
    buttonEls.set(def.id, btn);
  }

  function refresh() {
    for (const def of buttons) {
      const btn = buttonEls.get(def.id);
      btn.disabled = !def.enabled();
    }
    const pauseBtn = buttonEls.get('pause');
    if (pauseBtn) pauseBtn.textContent = state.paused ? 'RESUME' : 'PAUSE';
  }

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['input', 'textarea', 'select'].includes(document.activeElement?.tagName.toLowerCase())) return;
    if (key === 'g') actions.toggleAutoDig();
    if (key === 'c') actions.forceChamber();
    const def = buttons.find((b) => b.key === key);
    if (!def) return;
    if (!def.enabled()) return toast.show('Surface only');
    def.onClick();
    refresh();
  });

  viewManager.onChange(refresh);
  refresh();

  return { refresh };
}
