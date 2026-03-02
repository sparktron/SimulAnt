export function createMapEditorOverlay(onModeChange) {
  const panel = document.getElementById('mapEditorOverlay');
  const select = document.getElementById('editorModeSelect');
  if (!panel || !select) return { setActive: () => {}, getMode: () => 'dig' };

  select.addEventListener('change', () => onModeChange(select.value));

  return {
    setActive(active) {
      panel.hidden = !active;
    },
    getMode() {
      return select.value;
    },
  };
}
