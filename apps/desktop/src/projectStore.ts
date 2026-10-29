import { create } from 'zustand';
import { createMission, parseMission, serializeMission, type Mission } from '@odc/core';
import {
  IMPORT_EXTENSIONS,
  importHome,
  importMissionFile,
  importedToMission,
} from '@odc/exporters';
import {
  closeApplication,
  openBinaryFile,
  readProjectFile,
  rememberProjectFile,
  writeProjectFile,
  type PickedFile,
} from './platform';
import {
  loadProjectData,
  persistProjectData,
  projectFileName,
  projectKey,
  rememberProject,
  rememberRecovery,
  type ProjectData,
  type RecentProject,
} from './projectStorage';
import { createSampleProject } from './sampleProject';
import { useStore } from './store';
import { useView } from './viewStore';
import { activeScene } from './sceneAccess';

const OPEN_FILTERS = [
  { name: 'Projects and missions', extensions: ['json', ...IMPORT_EXTENSIONS] },
  { name: 'OpenDroneCinematic project', extensions: ['json'] },
  { name: 'Litchi CSV', extensions: ['csv'] },
  { name: 'DJI KMZ / WPML', extensions: ['kmz', 'kml', 'wpml'] },
  { name: 'QGroundControl plan', extensions: ['plan'] },
  { name: 'Mission Planner waypoints', extensions: ['waypoints', 'txt'] },
];

export type ProjectAction =
  | { kind: 'new' | 'sample' | 'open' | 'home' | 'close' }
  | { kind: 'recent' | 'recover'; key: string };

interface ProjectState {
  screen: 'home' | 'editor';
  active: boolean;
  path?: string;
  fileName?: string;
  /** Exact content last saved/read, so undoing back to it also clears the dirty indicator. */
  cleanContent?: string;
  dirty: boolean;
  savedAt?: number;
  recoveryAt?: number;
  recoveryState: 'idle' | 'pending' | 'saved' | 'error';
  busy?: 'opening' | 'saving';
  pendingAction?: ProjectAction;
  closeApproved: boolean;
  data: ProjectData;
  storageError?: string;
  actionError?: string;
  request(action: ProjectAction): Promise<void>;
  resolvePending(choice: 'save' | 'discard' | 'cancel'): Promise<void>;
  save(saveAs?: boolean): Promise<boolean>;
  resume(): void;
  removeRecent(key: string): void;
}

const loaded = loadProjectData();
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let switching = false;
let recoveryKeyWritten: string | undefined;

export const useProject = create<ProjectState>((set, get) => ({
  screen: 'home',
  active: false,
  dirty: false,
  recoveryState: 'idle',
  closeApproved: false,
  data: loaded.data,
  storageError: loaded.error,

  async request(action) {
    if (get().busy || get().pendingAction) return;
    if (useView.getState().render) {
      useStore.getState().notify('Finish or cancel the video render before leaving this project.');
      return;
    }
    if (action.kind === 'home') {
      flushProjectRecovery();
      useStore.getState().setPlaying(false);
      useView.getState().setFly(false);
      set({ screen: 'home', actionError: undefined });
      return;
    }
    if (get().active && get().dirty) {
      flushProjectRecovery();
      useStore.getState().setPlaying(false);
      useView.getState().setFly(false);
      set({ pendingAction: action });
      return;
    }
    await performAction(action);
  },

  async resolvePending(choice) {
    const action = get().pendingAction;
    if (!action || get().busy) return;
    if (choice === 'cancel') {
      set({ pendingAction: undefined });
      return;
    }
    if (choice === 'save') {
      if (!(await get().save())) return;
      // A save captures a snapshot. Never discard edits that arrived while it was being written.
      if (get().dirty) {
        useStore
          .getState()
          .notify('The project changed while saving. Save again before continuing.');
        return;
      }
    }
    const discardKey = choice === 'discard' ? currentProjectKey() : undefined;
    set({ pendingAction: undefined });
    await performAction(action, discardKey);
  },

  async save(saveAs = false) {
    if (!get().active || get().busy) return false;
    const mission = useStore.getState().mission;
    const content = JSON.stringify(mission);
    const oldKey = currentProjectKey();
    const name = saveAs
      ? projectFileName(mission.name)
      : (get().fileName ?? projectFileName(mission.name));
    set({ busy: 'saving', actionError: undefined });
    try {
      const file = await writeProjectFile(
        name,
        serializeMission(mission),
        saveAs ? undefined : get().path,
      );
      if (!file) return false;
      const savedAt = Date.now();
      const key = projectKey(mission, file.path);
      const dirty = JSON.stringify(useStore.getState().mission) !== content;
      let data = rememberProject(get().data, {
        key,
        mission,
        path: file.path,
        fileName: file.name,
        savedAt,
        updatedAt: savedAt,
      });
      data = {
        ...data,
        recoveries: data.recoveries.filter((r) => r.key !== oldKey && r.key !== key),
      };
      set({ path: file.path, fileName: file.name, cleanContent: content, dirty, savedAt, data });
      recoveryKeyWritten = undefined;
      flushProjectRecovery();
      useStore
        .getState()
        .notify(
          file.warning ??
            (file.path
              ? 'Project saved.'
              : 'Project copy downloaded. Keep the file somewhere safe.'),
        );
      return true;
    } catch (error) {
      reportError('Could not save the project', error);
      // A failed write never moves the clean baseline or loses the recovery draft.
      flushProjectRecovery();
      return false;
    } finally {
      set({ busy: undefined });
    }
  },

  resume() {
    if (get().active && !get().busy) set({ screen: 'editor' });
  },
  removeRecent(key) {
    const data = { ...get().data, recents: get().data.recents.filter((p) => p.key !== key) };
    set({ data, storageError: persistProjectData(data) });
  },
}));

function currentProjectKey() {
  return projectKey(useStore.getState().mission, useProject.getState().path);
}

function reportError(context: string, error: unknown) {
  const message = `${context}: ${error instanceof Error ? error.message : String(error)}`;
  useProject.setState({ actionError: message });
  useStore.getState().notify(message, 'error');
}

function activate(
  mission: Mission,
  options: {
    path?: string;
    fileName?: string;
    savedAt?: number;
    dirty?: boolean;
    recent?: RecentProject;
  } = {},
  discardKey?: string,
) {
  clearTimeout(recoveryTimer);
  switching = true;
  try {
    useStore.getState().loadMission(mission);
    // Rendered takes belong to the old project, not to a newly opened mission.
    for (const take of useView.getState().takes) URL.revokeObjectURL(take.url);
    useView.setState({
      fly: false,
      flyHud: undefined,
      takes: [],
      activeTakeId: undefined,
      compare: false,
    });
    let data = useProject.getState().data;
    if (discardKey)
      data = { ...data, recoveries: data.recoveries.filter((r) => r.key !== discardKey) };
    if (options.recent) data = rememberProject(data, options.recent);
    useProject.setState({
      screen: 'editor',
      active: true,
      path: options.path,
      fileName: options.fileName,
      cleanContent: options.dirty ? undefined : JSON.stringify(mission),
      dirty: options.dirty ?? false,
      savedAt: options.savedAt,
      recoveryAt: undefined,
      recoveryState: 'idle',
      actionError: undefined,
      data,
    });
    recoveryKeyWritten = undefined;
    flushProjectRecovery();
  } finally {
    switching = false;
  }
}

async function openPickedFile(file: PickedFile, discardKey?: string) {
  if (file.name.toLowerCase().endsWith('.json')) {
    const mission = parseMission(new TextDecoder().decode(file.data));
    const warning = await rememberProjectFile(file.path);
    const recent: RecentProject = {
      key: projectKey(mission, file.path),
      mission,
      path: file.path,
      fileName: file.name,
      updatedAt: Date.now(),
    };
    activate(mission, { path: file.path, fileName: file.name, recent }, discardKey);
    if (warning) useStore.getState().notify(warning);
    return;
  }
  const plan = importMissionFile(file.name, file.data);
  const ground = (await activeScene?.sampleGround([importHome(plan), ...plan.waypoints])) ?? [];
  const mission = importedToMission(plan, useStore.getState().mission, {
    home: ground[0] ?? 0,
    waypoints: ground.slice(1),
  });
  // Imported missions must be saved as projects, never back over the source CSV/KMZ/plan.
  mission.id = createMission(mission.takeoff).id;
  mission.name = file.name.replace(/\.[^.]+$/, '');
  activate(mission, { dirty: true }, discardKey);
  const warnings = [...plan.warnings];
  if (!ground.length)
    warnings.push(
      'Terrain heights were not sampled. Verify altitudes and clearance before flying.',
    );
  useStore
    .getState()
    .notify(`Imported ${plan.waypoints.length} waypoints. ${warnings.join(' ')}`.trim());
}

async function performAction(action: ProjectAction, discardKey?: string) {
  useProject.setState({ busy: 'opening', actionError: undefined });
  try {
    switch (action.kind) {
      case 'new': {
        const current = useStore.getState().mission;
        activate(createMission(current.takeoff, current.droneProfileId), {}, discardKey);
        break;
      }
      case 'sample':
        activate(createSampleProject(), { dirty: true }, discardKey);
        useStore
          .getState()
          .notify(
            'Practice project only: terrain heights are illustrative, and airspace is not checked.',
          );
        break;
      case 'open': {
        const file = await openBinaryFile(OPEN_FILTERS);
        if (file) await openPickedFile(file, discardKey);
        break;
      }
      case 'recent': {
        const recent = useProject.getState().data.recents.find((p) => p.key === action.key);
        if (!recent)
          throw new Error('This project is no longer in the recent list. Use Open project.');
        if (recent.path) {
          await openPickedFile(await readProjectFile(recent.path), discardKey);
        } else {
          // Browsers cannot silently re-read files. Be explicit that this is the last saved snapshot.
          activate(
            recent.mission,
            {
              fileName: recent.fileName,
              savedAt: recent.savedAt,
              recent: { ...recent, updatedAt: Date.now() },
            },
            discardKey,
          );
          useStore
            .getState()
            .notify(
              'Opened the saved browser snapshot. Use Open project for changes made to the file elsewhere.',
            );
        }
        break;
      }
      case 'recover': {
        const recovery = useProject.getState().data.recoveries.find((r) => r.key === action.key);
        if (!recovery) throw new Error('This recovery draft is no longer available.');
        activate(recovery.mission, { ...recovery, dirty: true }, discardKey);
        useStore.getState().notify('Local draft recovered. Review it, then Save or Save as.');
        break;
      }
      case 'close': {
        if (discardKey) {
          const data = useProject.getState().data;
          const next = { ...data, recoveries: data.recoveries.filter((r) => r.key !== discardKey) };
          useProject.setState({ data: next, storageError: persistProjectData(next) });
        } else flushProjectRecovery();
        useProject.setState({ closeApproved: true });
        await closeApplication();
        break;
      }
    }
  } catch (error) {
    useProject.setState({ closeApproved: false });
    if (action.kind === 'close') flushProjectRecovery();
    reportError(
      action.kind === 'close'
        ? 'Could not close the app. Your work is still open'
        : 'Could not open or switch project. Your current work is unchanged',
      error,
    );
  } finally {
    useProject.setState({ busy: undefined });
  }
}

/** Flush immediately before a page hide, close request, save, or project switch. */
export function flushProjectRecovery() {
  clearTimeout(recoveryTimer);
  const state = useProject.getState();
  if (state.closeApproved) return;
  let data = state.data;
  if (state.active) {
    const mission = useStore.getState().mission;
    const key = projectKey(mission, state.path);
    if (state.dirty) {
      data = rememberRecovery(data, {
        key,
        mission,
        path: state.path,
        fileName: state.fileName,
        savedAt: state.savedAt,
        updatedAt: Date.now(),
      });
      recoveryKeyWritten = key;
    } else if (recoveryKeyWritten === key) {
      data = { ...data, recoveries: data.recoveries.filter((r) => r.key !== key) };
    }
  }
  const error = persistProjectData(data);
  useProject.setState({
    data,
    storageError: error,
    recoveryState: state.dirty ? (error ? 'error' : 'saved') : 'idle',
    recoveryAt: state.dirty && !error ? Date.now() : state.recoveryAt,
  });
}

useStore.subscribe((state, previous) => {
  if (switching || state.mission === previous.mission || !useProject.getState().active) return;
  const dirty = JSON.stringify(state.mission) !== useProject.getState().cleanContent;
  useProject.setState({ dirty, recoveryState: dirty ? 'pending' : 'idle' });
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(flushProjectRecovery, 500);
});
