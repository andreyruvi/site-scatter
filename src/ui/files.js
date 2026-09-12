/**
 * Files in and out.
 *
 * Nothing is uploaded. A site layout is a client's plot and a client's
 * programme, and the only place either belongs is the machine it was drawn on.
 * The control settings are remembered between visits because retyping them is
 * tedious; the scheme itself is not, because a preset is a better place for it
 * than a browser's storage quota.
 */

const STORE_KEY = 'site-scatter:settings:v1';

/** Hand the browser a text file. */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Ask for a file. Resolves to an empty list if the user cancels. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('change', () => resolve([...(input.files || [])]));
    input.click();
  });
}

export function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}`)));
    reader.readAsText(file);
  });
}

/** The canvas as a PNG. */
export function canvasToPng(canvas, filename) {
  return new Promise((resolve, reject) => {
    if (!canvas.toBlob) {
      reject(new Error('This browser cannot save the view as an image.'));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The view could not be captured.'));
        return;
      }
      downloadBlob(filename, blob);
      resolve(blob.size);
    }, 'image/png');
  });
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  try {
    const text = localStorage.getItem(STORE_KEY);
    if (!text) return null;
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}
