import { getSettings, setSettings, type Settings } from '../shared/settings.js';

function checkbox(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing checkbox #${id}`);
  return el;
}

function flashSaved(): void {
  const saved = document.getElementById('saved');
  if (!saved) return;
  saved.classList.add('show');
  setTimeout(() => saved.classList.remove('show'), 1200);
}

async function init(): Promise<void> {
  const settings = await getSettings();

  const fields: Array<[HTMLInputElement, keyof Settings]> = [
    [checkbox('enabled'), 'enabled'],
    [checkbox('alwaysExpand'), 'alwaysExpand'],
  ];

  for (const [input, key] of fields) {
    input.checked = settings[key];
    input.addEventListener('change', async () => {
      await setSettings({ [key]: input.checked });
      flashSaved();
    });
  }
}

void init();
