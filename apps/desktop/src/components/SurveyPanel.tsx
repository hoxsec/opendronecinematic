import { useState } from 'react';
import {
  DEFAULT_SURVEY,
  bestSurveyAngle,
  haversine,
  missionProfile,
  planSurvey,
  surveyWaypoints,
  type SurveySpec,
} from '@odc/core';
import { useStore } from '../store';
import { activeScene } from './GlobeView';
import { Field, NumberInput, Section } from './fields';

/** Most cameras need about two seconds between photos to write them. */
const MIN_PHOTO_SECONDS = 2;

export function SurveyPanel() {
  const mission = useStore((s) => s.mission);
  const mode = useStore((s) => s.mode);
  const { setMode, updateSurvey } = useStore.getState();
  const [busy, setBusy] = useState(false);
  const survey = mission.survey;
  const drawing = mode === 'drawSurvey';
  const spec: SurveySpec = { ...DEFAULT_SURVEY, polygon: [], ...survey };
  const up = (patch: Partial<SurveySpec>) => updateSurvey(patch);
  const ready = spec.polygon.length >= 3;
  const plan = ready ? planSurvey(missionProfile(mission), spec) : undefined;
  const speed = spec.speed ?? mission.settings.speed;
  const photoSeconds = plan ? plan.stats.triggerDistance / speed : Infinity;

  const generate = async () => {
    if (!plan || plan.points.length === 0) return;
    setBusy(true);
    try {
      const st = useStore.getState();
      let m = st.mission;
      // An area far from takeoff almost certainly means "plan here": take off at its first corner.
      const corner = spec.polygon[0]!;
      if (haversine(m.takeoff, corner) > 2000) {
        const [g] = (await activeScene?.sampleGround([corner])) ?? [];
        m = { ...m, takeoff: { ...corner, groundHeight: g ?? m.takeoff.groundHeight } };
      }
      const grounds = (await activeScene?.sampleGround(plan.points)) ?? [];
      const waypoints = surveyWaypoints(m, spec, plan, grounds);
      st.setMission({
        ...m,
        waypoints,
        settings: { ...m.settings, pathMode: 'straight' },
      });
      st.setMode('select');
      st.setTime(0);
      st.notify(
        `Survey: ${plan.lines} lines, ${waypoints.length} waypoints, ~${plan.photos} photos.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Survey"
      actions={
        <button
          className={drawing ? 'active' : ''}
          onClick={() => setMode(drawing ? 'select' : 'drawSurvey')}
        >
          {drawing ? 'Done' : ready ? 'Add corners' : 'Draw area'}
        </button>
      }
    >
      {!ready && (
        <p className="muted">
          Click “Draw area”, then click the globe to outline the area to map. Drag corners to
          adjust; undo removes the last one.
        </p>
      )}
      {survey && (
        <>
          <div className="grid2">
            <Field label="Height (AGL)" hint="Height above the ground. Sets the image resolution.">
              <NumberInput
                value={spec.height}
                min={5}
                suffix="m"
                onChange={(height) => up({ height })}
              />
            </Field>
            <Field label="Speed">
              <NumberInput
                value={speed}
                step={0.5}
                min={0.5}
                suffix="m/s"
                onChange={(v) => up({ speed: v })}
              />
            </Field>
            <Field label="Front overlap">
              <NumberInput
                value={spec.frontOverlap}
                min={0}
                max={95}
                suffix="%"
                onChange={(frontOverlap) => up({ frontOverlap })}
              />
            </Field>
            <Field label="Side overlap">
              <NumberInput
                value={spec.sideOverlap}
                min={0}
                max={95}
                suffix="%"
                onChange={(sideOverlap) => up({ sideOverlap })}
              />
            </Field>
            <Field label="Line angle" hint="Direction the lines run, clockwise from north.">
              <span className="button-row">
                <NumberInput
                  value={spec.angle}
                  min={0}
                  max={179}
                  suffix="°"
                  onChange={(angle) => up({ angle })}
                />
                <button
                  disabled={!ready}
                  title="Run lines along the longest edge for the fewest turns"
                  onClick={() => up({ angle: bestSurveyAngle(spec.polygon) })}
                >
                  Auto
                </button>
              </span>
            </Field>
            <Field label="Gimbal">
              <NumberInput
                value={spec.gimbalPitch}
                min={-90}
                max={0}
                suffix="°"
                onChange={(gimbalPitch) => up({ gimbalPitch })}
              />
            </Field>
            <Field
              label="Overshoot"
              hint="Extend lines past the outline so its edges are fully covered."
            >
              <NumberInput
                value={spec.overshoot}
                min={0}
                suffix="m"
                onChange={(overshoot) => up({ overshoot })}
              />
            </Field>
            <Field
              label="Terrain follow"
              hint="Add a waypoint every N metres along each line so the height follows the ground. 0 = off."
            >
              <NumberInput
                value={spec.terrainFollowSpacing}
                min={0}
                step={10}
                suffix="m"
                onChange={(terrainFollowSpacing) => up({ terrainFollowSpacing })}
              />
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={spec.crosshatch}
              onChange={(e) => up({ crosshatch: e.target.checked })}
            />
            Crosshatch (second grid at 90°, for 3D models)
          </label>
          {plan && (
            <p className="stats">
              {(plan.stats.area / 10000).toFixed(2)} ha · GSD {plan.stats.gsd.toFixed(2)} cm/px ·{' '}
              {plan.lines} lines {plan.stats.lineSpacing.toFixed(0)} m apart · photo every{' '}
              {plan.stats.triggerDistance.toFixed(1)} m · ~{plan.photos} photos
            </p>
          )}
          {photoSeconds < MIN_PHOTO_SECONDS && (
            <p className="note">
              A photo every {photoSeconds.toFixed(1)} s is faster than most cameras can shoot. Slow
              down or fly higher.
            </p>
          )}
          <div className="button-row">
            <button className="primary" disabled={!plan?.points.length || busy} onClick={generate}>
              Generate waypoints
            </button>
            <button
              onClick={() => {
                updateSurvey(undefined);
                if (drawing) setMode('select');
              }}
            >
              Clear area
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
