import { getSettings, setSettings, isDevEndpoint, isTheme, type Settings } from '../shared/settings.js';
import { clearDisagreements, exportDisagreements, listDisagreements } from '../shared/feedback.js';
import { clearCache, readCache, CACHE_CAP, CACHE_TTL_DAYS } from '../shared/cache.js';

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
  const fields: Array<[HTMLInputElement, 'enabled' | 'alwaysExpand' | 'adsEnabled']> = [
    [checkbox('enabled'), 'enabled'],
    [checkbox('alwaysExpand'), 'alwaysExpand'],
    [checkbox('adsEnabled'), 'adsEnabled'],
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
  await wireFeedback();
  await wireGradeCache();
}

/**
 * The grade cache's controls.
 *
 * One button, and a count. The cache is a record of products the user has
 * opened, so the page has to make it visible and erasable — a local store the
 * user cannot see or empty is indistinguishable from one they should not have
 * been given. The cap and the retention window are printed from the constants
 * the code enforces rather than typed into the copy, so the disclosure cannot
 * quietly drift away from the behaviour it describes.
 */
async function wireGradeCache(): Promise<void> {
  const count = document.getElementById('gradeCacheCount');
  const status = document.getElementById('gradeCacheStatus');
  const clearButton = document.getElementById('gradeCacheClear');
  if (!count || !status || !clearButton) return;

  async function refresh(): Promise<void> {
    const remembered = (await readCache()).size;
    count!.textContent =
      remembered === 0
        ? `No grades remembered yet. Up to ${CACHE_CAP} are kept, for ${CACHE_TTL_DAYS} days each.`
        : `${remembered} ${remembered === 1 ? 'grade' : 'grades'} remembered, of a maximum `
          + `${CACHE_CAP}, kept ${CACHE_TTL_DAYS} days each.`;

    (clearButton as HTMLButtonElement).disabled = remembered === 0;
  }

  clearButton.addEventListener('click', async () => {
    await clearCache();
    await refresh();
    status!.textContent = 'Erased.';
  });

  await refresh();
}

/**
 * The feedback log's controls.
 *
 * Export and delete, and nothing else. There is deliberately no "send to us"
 * button: the moment this page could transmit, the no-telemetry promise would
 * depend on a click rather than on the code, and PRIVACY.md would be describing
 * an intention instead of a fact.
 */
async function wireFeedback(): Promise<void> {
  const count = document.getElementById('feedbackCount');
  const status = document.getElementById('feedbackStatus');
  const exportButton = document.getElementById('feedbackExport');
  const clearButton = document.getElementById('feedbackClear');
  if (!count || !status || !exportButton || !clearButton) return;

  async function refresh(): Promise<void> {
    const records = await listDisagreements();
    count!.textContent =
      records.length === 0
        ? 'Nothing recorded yet.'
        : `${records.length} ${records.length === 1 ? 'grade' : 'grades'} recorded on this device.`;

    const empty = records.length === 0;
    (exportButton as HTMLButtonElement).disabled = empty;
    (clearButton as HTMLButtonElement).disabled = empty;
  }

  exportButton.addEventListener('click', async () => {
    const json = await exportDisagreements();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));

    const link = document.createElement('a');
    link.href = url;
    link.download = `winnow-feedback-${new Date().toISOString().slice(0, 10)}.json`;
    // In the document, because a detached anchor's click is ignored in some
    // Chrome configurations and the export would appear to do nothing.
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();

    // Revoking the object URL in the same task can cancel the download that was
    // just started — the browser has not necessarily finished reading the blob
    // when click() returns. Deferring it releases the memory without racing the
    // thing it was created for.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    status!.textContent = 'Downloaded. The copy on this device is unchanged.';
  });

  clearButton.addEventListener('click', async () => {
    await clearDisagreements();
    await refresh();
    status!.textContent = 'Deleted.';
  });

  await refresh();
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
