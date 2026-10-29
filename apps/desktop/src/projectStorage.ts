import { parseMission, type Mission } from '@odc/core';

export const PROJECTS_KEY = 'odc.projects.v1';
export const LEGACY_AUTOSAVE_KEY = 'odc.autosave.v1';
export const RECENT_LIMIT = 12;
export const RECOVERY_LIMIT = 8;

export interface ProjectRecovery {
  key: string;
  mission: Mission;
  path?: string;
  fileName?: string;
  savedAt?: number;
  updatedAt: number;
}

export interface RecentProject extends ProjectRecovery {
  fileName: string;
}

export interface ProjectData {
  version: 1;
  recents: RecentProject[];
  recoveries: ProjectRecovery[];
}

export const emptyProjectData = (): ProjectData => ({ version: 1, recents: [], recoveries: [] });

export function projectKey(mission: Mission, path?: string) {
  // Windows paths are case-insensitive; don't change case on other platforms.
  const normalized = path?.replace(/\\/g, '/');
  return normalized
    ? `file:${/^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized}`
    : `mission:${mission.id}`;
}

/** Recovery data is untrusted too: don't let a damaged entry break the home screen. */
function readSnapshot(value: unknown): ProjectRecovery {
  if (!value || typeof value !== 'object') throw new Error('Invalid project entry.');
  const v = value as ProjectRecovery;
  const mission = parseMission(JSON.stringify(v.mission));
  if (
    typeof mission.id !== 'string' ||
    typeof mission.name !== 'string' ||
    typeof mission.droneProfileId !== 'string' ||
    !Array.isArray(mission.pois) ||
    !Number.isFinite(v.updatedAt) ||
    !Number.isFinite(new Date(v.updatedAt).getTime()) ||
    (v.path !== undefined && typeof v.path !== 'string') ||
    (v.fileName !== undefined && typeof v.fileName !== 'string') ||
    (v.savedAt !== undefined &&
      (!Number.isFinite(v.savedAt) || !Number.isFinite(new Date(v.savedAt).getTime())))
  )
    throw new Error('Invalid project entry.');
  return { ...v, mission, key: projectKey(mission, v.path) };
}

export function loadProjectData(storage?: Storage): { data: ProjectData; error?: string } {
  const data = emptyProjectData();
  try {
    storage ??= globalThis.localStorage;
    if (!storage) return { data };
    const raw = storage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProjectData;
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.recents) ||
        !Array.isArray(parsed.recoveries)
      )
        throw new Error('Invalid project history.');
      let damaged = false;
      const readEntries = (entries: unknown[]) =>
        entries.flatMap((entry) => {
          try {
            return [readSnapshot(entry)];
          } catch {
            damaged = true;
            return [];
          }
        });
      data.recents = readEntries(parsed.recents)
        .filter((entry): entry is RecentProject => typeof entry.fileName === 'string')
        .slice(0, RECENT_LIMIT);
      data.recoveries = readEntries(parsed.recoveries).slice(0, RECOVERY_LIMIT);
      return {
        data,
        error: damaged
          ? 'Some damaged project-history entries could not be loaded. Your project files are unchanged.'
          : undefined,
      };
    }
    // Preserve work from versions that silently reopened a single autosave.
    const legacy = storage.getItem(LEGACY_AUTOSAVE_KEY);
    if (legacy) {
      const mission = parseMission(legacy);
      data.recoveries = [readSnapshot({ mission, updatedAt: Date.now() })];
    }
    return { data };
  } catch {
    return {
      data,
      error: 'Project history could not be read. Open your saved project file to continue.',
    };
  }
}

/** One atomic storage entry keeps the index and recovery snapshots in agreement. */
export function persistProjectData(data: ProjectData, storage?: Storage): string | undefined {
  try {
    storage ??= globalThis.localStorage;
    if (!storage) throw new Error('Storage unavailable.');
    storage.setItem(PROJECTS_KEY, JSON.stringify(data));
    // Only retire the legacy copy after its replacement was written successfully.
    storage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    return 'Local recovery could not be updated. Storage may be full or unavailable. Save your project to a file.';
  }
}

export function rememberProject(data: ProjectData, project: RecentProject): ProjectData {
  return {
    ...data,
    recents: [project, ...data.recents.filter((p) => p.key !== project.key)].slice(0, RECENT_LIMIT),
  };
}

export function rememberRecovery(data: ProjectData, recovery: ProjectRecovery): ProjectData {
  return {
    ...data,
    recoveries: [recovery, ...data.recoveries.filter((p) => p.key !== recovery.key)].slice(
      0,
      RECOVERY_LIMIT,
    ),
  };
}

export function projectFileName(name: string) {
  let safe = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 100);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return `${safe || 'mission'}.odc.json`;
}
