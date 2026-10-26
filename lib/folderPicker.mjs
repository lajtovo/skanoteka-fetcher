import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DIALOG_TIMEOUT_MS = 10 * 60 * 1000; // dialog może stać otwarty, póki użytkownik się zastanawia

/**
 * Otwiera natywne okno wyboru folderu (tam gdzie to możliwe) i zwraca
 * wybraną ścieżkę. Przeglądarka ze względów bezpieczeństwa nie daje dostępu
 * do prawdziwej ścieżki na dysku, więc okno musi otworzyć proces serwera
 * (działa tylko lokalnie, na 127.0.0.1 — patrz PLAN.md).
 */
export async function pickFolder() {
  if (process.platform === 'darwin') return pickFolderMac();
  if (process.platform === 'win32') return pickFolderWindows();
  return pickFolderLinux();
}

async function pickFolderMac() {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Wybierz folder do zapisu skanów")'],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return { path: stdout.trim() };
  } catch (err) {
    if (/User canceled|-128/.test(err.stderr || err.message || '')) return { cancelled: true };
    throw err;
  }
}

async function pickFolderWindows() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $f = New-Object System.Windows.Forms.FolderBrowserDialog
    $f.Description = 'Wybierz folder do zapisu skanow'
    if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }
  `;
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
    timeout: DIALOG_TIMEOUT_MS
  });
  const chosen = stdout.trim();
  return chosen ? { path: chosen } : { cancelled: true };
}

async function pickFolderLinux() {
  try {
    const { stdout } = await execFileAsync(
      'zenity',
      ['--file-selection', '--directory', '--title=Wybierz folder do zapisu skanów'],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return { path: stdout.trim() };
  } catch (err) {
    if (err.code === 1) return { cancelled: true }; // zenity: Cancel
    if (err.code === 'ENOENT') {
      const notSupported = new Error('Brak natywnego okna wyboru folderu na tym systemie (zainstaluj zenity albo wklej ścieżkę ręcznie)');
      notSupported.notSupported = true;
      throw notSupported;
    }
    throw err;
  }
}
