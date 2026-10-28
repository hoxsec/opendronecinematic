import { DRONE_PROFILES, fmtTime, type AltitudeMode, type MissionSettings } from '@odc/core';
import { useStore } from '../store';
import { useCamera, usePath } from '../derived';
import { Field, NumberInput, Section, Select } from './fields';

const ALT_MODES: { value: AltitudeMode; label: string }[] = [
  { value: 'relativeToTakeoff', label: 'Relative to takeoff' },
  { value: 'AGL', label: 'Above ground (AGL)' },
  { value: 'ellipsoid', label: 'WGS84 ellipsoid' },
];

export function MissionPanel() {
  const mission = useStore((s) => s.mission);
  const { setMission, setAltitudeMode } = useStore.getState();
  const { profile, fov } = useCamera();
  const path = usePath();
  const setSettings = (patch: Partial<MissionSettings>) =>
    setMission((m) => ({ ...m, settings: { ...m.settings, ...patch } }));

  return (
    <Section title="Mission">
      <Field label="Name">
        <input
          value={mission.name}
          onChange={(e) => setMission((m) => ({ ...m, name: e.target.value }), { history: false })}
        />
      </Field>
      <Field label="Drone">
        <Select
          value={mission.droneProfileId}
          options={DRONE_PROFILES.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(droneProfileId) => setMission((m) => ({ ...m, droneProfileId }))}
        />
      </Field>
      {mission.droneProfileId === 'custom' && (
        <div className="grid3">
          <Field label="Focal (35mm eq)">
            <NumberInput
              value={mission.customProfile?.equivalentFocalMm ?? profile.equivalentFocalMm}
              suffix="mm"
              onChange={(v) =>
                setMission((m) => ({
                  ...m,
                  customProfile: { ...m.customProfile, equivalentFocalMm: v },
                }))
              }
            />
          </Field>
          <Field label="Max speed">
            <NumberInput
              value={mission.customProfile?.maxSpeed ?? profile.maxSpeed}
              suffix="m/s"
              onChange={(v) =>
                setMission((m) => ({ ...m, customProfile: { ...m.customProfile, maxSpeed: v } }))
              }
            />
          </Field>
          <Field label="Battery">
            <NumberInput
              value={mission.customProfile?.batteryMinutes ?? profile.batteryMinutes}
              suffix="min"
              onChange={(v) =>
                setMission((m) => ({
                  ...m,
                  customProfile: { ...m.customProfile, batteryMinutes: v },
                }))
              }
            />
          </Field>
        </div>
      )}
      <Field label="Altitudes" hint="Changing this re-expresses every waypoint without moving it.">
        <Select value={mission.altitudeMode} options={ALT_MODES} onChange={setAltitudeMode} />
      </Field>
      <div className="grid3">
        <Field label="Speed">
          <NumberInput
            value={mission.settings.speed}
            step={0.5}
            min={0.5}
            suffix="m/s"
            onChange={(speed) => setSettings({ speed })}
          />
        </Field>
        <Field label="Gimbal">
          <NumberInput
            value={mission.settings.gimbalPitch}
            min={-90}
            max={30}
            suffix="°"
            onChange={(gimbalPitch) => setSettings({ gimbalPitch })}
          />
        </Field>
        <Field label="Path">
          <Select
            value={mission.settings.pathMode}
            options={[
              { value: 'smooth', label: 'Smooth' },
              { value: 'straight', label: 'Straight' },
            ]}
            onChange={(pathMode) => setSettings({ pathMode })}
          />
        </Field>
      </div>
      <Field label="On finish">
        <Select
          value={mission.settings.finishAction}
          options={[
            { value: 'hover', label: 'Hover' },
            { value: 'returnHome', label: 'Return home' },
            { value: 'land', label: 'Land' },
          ]}
          onChange={(finishAction) => setSettings({ finishAction })}
        />
      </Field>
      <p className="stats">
        {mission.waypoints.length} waypoints · {Math.round(path.length)} m ·{' '}
        {fmtTime(path.duration)} · FOV {fov.horizontal.toFixed(0)}°×{fov.vertical.toFixed(0)}°
      </p>
      {profile.notes && <p className="note">{profile.notes}</p>}
    </Section>
  );
}
