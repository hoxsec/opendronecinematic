import { useProject } from '../projectStore';
import { useView } from '../viewStore';
import { FlightOutline } from './FlightOutline';
import { PoiPanel } from './PoiPanel';

export function PlannerSidebar() {
  const open = useView((s) => s.outlineOpen);
  const storageError = useProject((s) => s.storageError);
  const actionError = useProject((s) => s.actionError);
  return (
    <aside className="sidebar flight-sidebar" aria-label="Flight organization" hidden={!open}>
      <FlightOutline />
      <PoiPanel />
      {(storageError || actionError) && (
        <div className="project-warning" role="alert">
          {storageError && <p>{storageError}</p>}
          {actionError && <p>{actionError}</p>}
        </div>
      )}
    </aside>
  );
}
