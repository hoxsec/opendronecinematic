import { useEffect, useRef } from 'react';
import { useProject } from '../projectStore';
import { useStore } from '../store';
import { Icon } from './Icon';

/** A focused, keyboard-accessible guard shared by project switches and native window close. */
export function UnsavedDialog() {
  const { resolvePending, busy, pendingAction } = useProject();
  const name = useStore((s) => s.mission.name);
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          void resolvePending('cancel');
        }
        if (e.key === 'Tab') {
          const buttons = [
            ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
          ];
          const first = buttons[0];
          const last = buttons.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        className="modal unsaved-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-description"
        ref={ref}
      >
        <span className="dialog-symbol">
          <Icon name="save" size={25} />
        </span>
        <h2 id="unsaved-title">Save your changes?</h2>
        <p id="unsaved-description">
          “{name || 'Untitled mission'}” has changes that are not saved to a project file.{' '}
          {pendingAction?.kind === 'close'
            ? 'Save them before closing the app.'
            : 'Save them before switching projects.'}
        </p>
        <p className="muted small">
          {pendingAction?.kind === 'close'
            ? 'Discard changes also removes this project’s local recovery draft.'
            : 'Discard changes removes this project’s local recovery draft only after the next project opens successfully.'}
        </p>
        <div className="unsaved-actions">
          <button
            className="discard-button"
            disabled={!!busy}
            onClick={() => void resolvePending('discard')}
          >
            Discard changes
          </button>
          <div>
            <button ref={cancel} disabled={!!busy} onClick={() => void resolvePending('cancel')}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void resolvePending('save')}
            >
              <Icon name="save" size={16} />
              {busy === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
