import { getSettings, setSettings, isDevEndpoint, isTheme, type Settings } from '../shared/settings.js';

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

  // Only the boolean settings are checkbox-driven; theme and devApiEndpoint
  // have their own controls.
  const fields: Array<[HTMLInputElement, 'enabled' | 'alwaysExpand']> = [
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

  wireTheme(settings);
  await wireDevEndpoint(settings);
}

function wireTheme(settings: Settings): void {
  const select = document.getElementById('theme');
  if (!(select instanceof HTMLSelectElement)) return;

  select.value = settings.theme;
  select.addEventListener('change', async () => {
    if (!isTheme(select.value)) return;
    await setSettings({ theme: select.value });
    flashSaved();
  });
}

/**
 * Dev endpoint field.
 *
 * Rejects anything that is not loopback, and requests the optional host
 * permission on demand so a normal install never carries localhost access.
 */
async function wireDevEndpoint(settings: Settings): Promise<void> {
  const input = document.getElementById('devApiEndpoint');
  const status = document.getElementById('devStatus');
  if (!(input instanceof HTMLInputElement) || !status) return;

  input.value = settings.devApiEndpoint;
  if (settings.devApiEndpoint) status.textContent = 'Using the local server.';

  input.addEventListener('change', async () => {
    const value = input.value.trim();

    if (value === '') {
      await setSettings({ devApiEndpoint: '' });
      status.textContent = 'Using the live server.';
      flashSaved();
      return;
    }

    if (!isDevEndpoint(value)) {
      status.textContent = 'Rejected — only localhost and 127.0.0.1 are allowed here.';
      return;
    }

    const origin = new URL(value).origin + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) {
      status.textContent = 'Permission for that address was declined, so the setting was not saved.';
      return;
    }

    await setSettings({ devApiEndpoint: value });
    status.textContent = 'Using the local server.';
    flashSaved();
  });
}

void init();
