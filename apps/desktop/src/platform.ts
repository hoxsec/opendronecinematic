// File access that works both inside Tauri (native dialogs, real paths) and in a plain browser
// (downloads and <input type=file>), so the UI can be developed and tested with `npm run dev`.

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function saveFile(
  defaultName: string,
  data: string | Uint8Array | Blob,
  filters: FileFilter[],
) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return false;
    if (typeof data === 'string') await writeTextFile(path, data);
    else if (data instanceof Blob) await writeFile(path, new Uint8Array(await data.arrayBuffer()));
    else await writeFile(path, data);
    return true;
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function openTextFile(filters: FileFilter[]): Promise<string | undefined> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, directory: false, filters });
    return typeof path === 'string' ? readTextFile(path) : undefined;
  }
  const file = await pickBrowserFile(filters);
  return file?.text();
}

function pickBrowserFile(filters: FileFilter[]): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export interface PickedFile {
  name: string;
  data: Uint8Array;
  /** Browser downloads and file inputs intentionally don't expose a writable path. */
  path?: string;
}

/** Pick any file and read its bytes, keeping the name so the caller can tell formats apart. */
export async function openBinaryFile(filters: FileFilter[]): Promise<PickedFile | undefined> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, directory: false, filters });
    if (typeof path !== 'string') return undefined;
    return { name: path.split(/[\\/]/).pop() ?? path, path, data: await readFile(path) };
  }
  const file = await pickBrowserFile(filters);
  return file ? { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } : undefined;
}

export async function readProjectFile(path: string): Promise<PickedFile> {
  if (!isTauri()) throw new Error('Use Open project to read the latest file in a browser.');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return { name: path.split(/[\\/]/).pop() ?? path, path, data: await readFile(path) };
}

export async function rememberProjectFile(path?: string): Promise<string | undefined> {
  if (!path || !isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('remember_project_path', { path });
  } catch {
    return 'The file is accessible now, but its permission could not be remembered. Use Open project to select it again after restarting.';
  }
}

/** Save writes back to the current desktop path; Save as always asks for a new destination. */
export async function writeProjectFile(
  defaultName: string,
  content: string,
  currentPath?: string,
): Promise<{ name: string; path?: string; warning?: string } | undefined> {
  const filters = [{ name: 'OpenDroneCinematic project', extensions: ['json'] }];
  if (!isTauri()) {
    await saveFile(defaultName, content, filters);
    return { name: defaultName };
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const path = currentPath ?? (await save({ defaultPath: defaultName, filters }));
  if (!path) return undefined;
  await writeTextFile(path, content);
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    warning: await rememberProjectFile(path),
  };
}

export async function closeApplication() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

/**
 * Let the user pick a local 3D Tiles folder (desktop only) and return a URL Cesium can load.
 * Tauri adds dialog-picked paths to the asset protocol scope, so no broad file access is granted.
 */
export async function pickLocalTileset(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const path = await open({
    multiple: false,
    filters: [{ name: '3D Tiles', extensions: ['json'] }],
  });
  return typeof path === 'string' ? convertFileSrc(path) : undefined;
}
