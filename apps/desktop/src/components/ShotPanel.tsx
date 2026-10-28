import { useState } from 'react';
import { SHOT_TEMPLATES, defaultStartBearing, generateShot, type ShotTemplate } from '@odc/core';
import { useStore } from '../store';
import { activeScene } from './GlobeView';
import { Field, NumberInput, Section, Select } from './fields';

export function ShotPanel() {
  const mission = useStore((s) => s.mission);
  const selectedId = useStore((s) => s.selectedId);
  const [kind, setKind] = useState<ShotTemplate>('orbit');
  const [radius, setRadius] = useState(60);
  const [height, setHeight] = useState(40);
  const [sweep, setSweep] = useState(360);
  const [climb, setClimb] = useState(40);
  const [bearing, setBearing] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const subject = mission.pois.find((p) => p.id === selectedId) ?? mission.pois[0];
  const info = SHOT_TEMPLATES.find((t) => t.id === kind)!;

  const apply = async (append: boolean) => {
    if (!subject) return;
    setBusy(true);
    try {
      const st = useStore.getState();
      const [ground] = (await activeScene?.sampleGround([subject])) ?? [];
      const groundHeight = ground ?? st.mission.takeoff.groundHeight;
      const shot = generateShot(st.mission, kind, {
        subject,
        groundHeight,
        radius,
        height,
        sweep,
        climb,
        startBearing: bearing ?? defaultStartBearing(st.mission, subject),
      });
      // Sample the real ground under each new waypoint so AGL and stems are correct.
      const grounds = (await activeScene?.sampleGround(shot.waypoints)) ?? [];
      const waypoints = shot.waypoints.map((w, i) => ({
        ...w,
        groundHeight: grounds[i] ?? w.groundHeight,
      }));
      st.setMission((m) => ({
        ...m,
        waypoints: append ? [...m.waypoints, ...waypoints] : waypoints,
      }));
      st.setTime(0);
      st.notify(`${info.name}: ${waypoints.length} waypoints around ${subject.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const orbital = kind === 'orbit' || kind === 'helix';
  return (
    <Section title="Shot templates">
      <Field label="Move">
        <Select
          value={kind}
          options={SHOT_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))}
          onChange={setKind}
        />
      </Field>
      <p className="muted">{info.description}</p>
      <div className="grid2">
        <Field label="Distance">
          <NumberInput value={radius} min={5} suffix="m" onChange={setRadius} />
        </Field>
        <Field label="Height">
          <NumberInput value={height} min={2} suffix="m" onChange={setHeight} />
        </Field>
        {orbital && (
          <Field label="Sweep">
            <NumberInput value={sweep} step={15} suffix="°" onChange={setSweep} />
          </Field>
        )}
        {(kind === 'helix' || kind === 'dronie') && (
          <Field label="Climb">
            <NumberInput value={climb} suffix="m" onChange={setClimb} />
          </Field>
        )}
        <Field
          label="Start bearing"
          hint="Compass direction from the subject. Empty = toward takeoff."
        >
          <NumberInput value={bearing} min={0} max={359} suffix="°" onChange={setBearing} />
        </Field>
      </div>
      {subject ? (
        <div className="button-row">
          <button className="primary" disabled={busy} onClick={() => apply(false)}>
            Replace waypoints
          </button>
          <button disabled={busy} onClick={() => apply(true)}>
            Append
          </button>
        </div>
      ) : (
        <p className="note">Add a point of interest first. Shots are built around it.</p>
      )}
      {subject && <p className="muted">Subject: {subject.name}</p>}
    </Section>
  );
}
