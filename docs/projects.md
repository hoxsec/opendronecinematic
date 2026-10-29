# Projects and recovery

OpenDroneCinematic is a local-first planner. There is no account or cloud project service. Terrain, imagery, geocoding, and other map services can still use the internet.

## Project home

The app starts on **Projects**, rather than automatically opening the last autosave.

- **New project** creates an empty plan using the current drone and takeoff location.
- **Open project** opens a `.odc.json` project or imports a supported mission file.
- **Recent projects** lists up to 12 opened/saved projects. Removing a recent entry only removes the shortcut, not its file or recovery draft.
- **Open practice project** creates an editable helix example. Its terrain heights are illustrative; it is not a verified flight plan.
- **Map settings** configures imagery, terrain, buildings, and offline data.

**Projects** in the editor header returns to home without discarding the current session. **Back to planner** resumes it. Playback and fly mode stop when returning home. Switching to a different project clears undo/redo, selections, playback, safety results, and session-only rendered takes.

## Saving a file

Projects keep the existing version-1 `.odc.json` format. They contain mission planning data, not downloaded map data, GeoTIFF files, or rendered video files.

| Command      | Shortcut     | Desktop behavior                                                            |
| ------------ | ------------ | --------------------------------------------------------------------------- |
| New project  | Ctrl+N       | Create a fresh project                                                      |
| Open project | Ctrl+O       | Choose a project or mission file                                            |
| Save         | Ctrl+S       | Update the current file, or choose a destination for a new/imported project |
| Save as…     | Ctrl+Shift+S | Choose a destination for a separate copy                                    |

The header distinguishes unsaved edits, saved project files, and local recovery status. Undoing to the content last read/saved clears the unsaved-change indicator. A canceled or failed save does not mark the project as saved. If edits arrive while a file is being written, those newer edits remain unsaved and are backed up separately.

Imported CSV, KMZ, `.plan`, and waypoint files are **never overwritten by Save**: save the imported mission as a new project. Imports made from home cannot use an active map viewer to sample terrain, so they warn that heights and clearance need verification.

### Recent files on Windows

Recent desktop projects re-read their actual files rather than opening stale snapshots. Only exact JSON files already authorized through a native Open/Save dialog have their permissions remembered across restarts; the app does not grant itself general disk access.

If a file was moved, deleted, or cannot be accessed, opening it shows an error and leaves the current project unchanged. Use **Open project** to locate and authorize it again.

### Browser behavior

A browser file input does not provide a writable path. **Save** and **Save as…** download project copies; they cannot silently update the source file. Keep the downloaded file in a safe location.

Browser recent projects open the **last saved snapshot stored by this browser**, not the current contents of the original file. Use **Open project** for changes made elsewhere. The home screen and save feedback make this distinction explicit.

## Local recovery

Edits update a recovery draft after a 500 ms pause. Returning home, saving, hiding the page, and requesting a close also attempt an immediate flush. Up to eight distinct project drafts are retained, newest first; older drafts beyond this limit are replaced. Work from the old single-autosave system is offered as a recovery draft during migration.

On the next launch, **Unsaved work → Recover** opens the draft with an unsaved indicator. Recovery never silently writes over the original project file. Review the recovered plan and choose **Save** or **Save as…**.

Creating/opening another project or closing the desktop window while there are unsaved changes offers:

- **Save changes:** save first, then continue. Canceling/failing the save keeps the current session and confirmation open.
- **Discard changes:** continue without saving and remove this project's recovery draft. When opening another file, the discard is committed only after that file opens successfully; canceling the picker or selecting a damaged file leaves current work intact.
- **Cancel:** stay in the current project.

Closing/reloading a browser tab uses the browser's standard unsaved-changes warning instead of the desktop close dialog.

### Limits

- Recovery and recent snapshots use this app/browser profile's local storage. Clearing application/browser data removes them.
- Storage can be unavailable, full, or lost. A persistent warning appears when recovery cannot be updated. Save a project file promptly.
- Abrupt termination can lose edits since the last successful recovery write. Recovery is best effort, not a guarantee of crash-proof storage.
- There is no multi-window editing coordination, external-file change detection, or version history in this milestone. Back up important project files separately.
- Local recovery is not encrypted. Use normal operating-system protections for sensitive planning locations.
- Mission parsing checks data structure before replacing the editor; it does not establish that a flight is safe or legal. Airspace restrictions are not checked.
