import { useMemo } from 'react';
import {
  dayPhases,
  lightPhase,
  localMidnight,
  meanHeading,
  sunPosition,
  sunRelation,
  type LightPhase,
  type PhaseSpan,
  type SunRelation,
} from '@odc/core';
import { useStore } from '../store';
import { useView } from '../viewStore';
import { usePath, useShoot, useSunTime } from '../derived';
import { Field, NumberInput, Section } from './fields';

const MINUTE = 60_000;
const DAY = 86_400_000;

export const PHASE_LABEL: Record<LightPhase, string> = {
  night: 'Night',
  blue: 'Blue hour',
  golden: 'Golden hour',
  day: 'Daylight',
};

export const RELATION_LABEL: Record<SunRelation, string> = {
  backlit: 'backlit (sun ahead)',
  'front-lit': 'front-lit (sun behind)',
  'side-left': 'side light from the left',
  'side-right': 'side light from the right',
};

/** ISO-ish local date and time strings for an instant at a UTC offset in minutes. */
function localParts(d: Date, utcOffset: number) {
  const iso = new Date(d.getTime() + utcOffset * MINUTE).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export const fmtClock = (d: Date, utcOffset: number) => localParts(d, utcOffset).time;

function fromLocal(date: string, time: string, utcOffset: number): Date | undefined {
  const ms = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(ms) ? new Date(ms - utcOffset * MINUTE) : undefined;
}

/** Shoot date and time, the day's light, and how the sun falls on the shot. */
export function SunPanel() {
  const mission = useStore((s) => s.mission);
  const { setMission } = useStore.getState();
  const shadows = useView((s) => s.shadows);
  const { start, utcOffset } = useShoot();
  const sunTime = useSunTime();
  const path = usePath();
  const { lat, lon } = mission.takeoff;
  const parts = localParts(start, utcOffset);
  const midnight = localMidnight(start, utcOffset).getTime();

  const spans = useMemo(
    () => dayPhases(new Date(midnight), lat, lon, utcOffset),
    [midnight, lat, lon, utcOffset],
  );
  // The way the camera mostly faces, to judge the light on the shot.
  const heading = useMemo(
    () => meanHeading(path.sampleByDistance(Math.max(5, path.length / 100)).map((s) => s.yaw)),
    [path],
  );

  const setShoot = (d: Date | undefined, offset = utcOffset) => {
    if (d) setMission((m) => ({ ...m, shoot: { start: d.toISOString(), utcOffset: offset } }));
  };
  const golden = spans.filter((s) => s.phase === 'golden');
  const eveningBlue = spans.find(
    (s) => s.phase === 'blue' && s.start.getTime() > midnight + DAY / 2,
  );

  const sun = sunPosition(sunTime, lat, lon);
  const relationAt = (d: Date) =>
    heading === undefined ? undefined : sunRelation(heading, sunPosition(d, lat, lon));
  const now = relationAt(sunTime);

  return (
    <Section title="Light">
      <div className="grid3">
        <Field label="Shoot date">
          <input
            type="date"
            value={parts.date}
            onChange={(e) => setShoot(fromLocal(e.target.value, parts.time, utcOffset))}
          />
        </Field>
        <Field label="Takeoff time">
          <input
            type="time"
            value={parts.time}
            onChange={(e) => setShoot(fromLocal(parts.date, e.target.value, utcOffset))}
          />
        </Field>
        <Field label="UTC offset" hint="The shoot location's clock, e.g. +2 for Swiss summer time">
          <NumberInput
            value={utcOffset / 60}
            step={0.5}
            min={-12}
            max={14}
            suffix="h"
            // Keep the local wall-clock time when the offset changes.
            onChange={(h) => setShoot(fromLocal(parts.date, parts.time, h * 60), h * 60)}
          />
        </Field>
      </div>

      <DayStrip
        spans={spans}
        midnight={midnight}
        marks={[start, sunTime]}
        onPick={(d) => setShoot(d)}
      />

      <div className="button-row">
        {golden.map((g, i) => {
          const morning = golden.length > 1 && i === 0;
          const label = morning ? 'Morning golden hour' : 'Evening golden hour';
          return (
            <button
              key={g.start.getTime()}
              onClick={() => setShoot(g.start)}
              title={`${label} ${fmtClock(g.start, utcOffset)}–${fmtClock(g.end, utcOffset)}`}
              aria-label={label}
            >
              {morning ? '🌅' : '🌇'}
            </button>
          );
        })}
        {eveningBlue && (
          <button
            onClick={() => setShoot(eveningBlue.start)}
            title={`Blue hour ${fmtClock(eveningBlue.start, utcOffset)}–${fmtClock(eveningBlue.end, utcOffset)}`}
            aria-label="Blue hour"
          >
            🌆
          </button>
        )}
      </div>

      <p className="stats">
        Sun {sun.azimuth.toFixed(0)}° · {sun.elevation.toFixed(1)}° up ·{' '}
        {PHASE_LABEL[lightPhase(sun.elevation)]}
        {now && sun.elevation > -1 && <> · {RELATION_LABEL[now]}</>}
      </p>
      {heading !== undefined && golden.length > 0 && (
        <ul className="sun-hints small">
          {golden.map((g) => {
            const mid = new Date((g.start.getTime() + g.end.getTime()) / 2);
            const rel = relationAt(mid);
            return (
              <li key={g.start.getTime()}>
                Golden {fmtClock(g.start, utcOffset)}–{fmtClock(g.end, utcOffset)}:{' '}
                {rel && RELATION_LABEL[rel]}
              </li>
            );
          })}
        </ul>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={shadows}
          onChange={(e) => useView.getState().setShadows(e.target.checked)}
        />
        Shadows in the camera view and renders
      </label>
    </Section>
  );
}

/** The local day as coloured light phases; click to set the takeoff time. */
function DayStrip({
  spans,
  midnight,
  marks,
  onPick,
}: {
  spans: PhaseSpan[];
  midnight: number;
  marks: Date[];
  onPick: (d: Date) => void;
}) {
  const pct = (d: Date) => `${((d.getTime() - midnight) / DAY) * 100}%`;
  return (
    <div
      className="day-strip"
      title="Click to set the takeoff time"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - r.left) / r.width;
        // Snap to five minutes.
        onPick(new Date(midnight + Math.round((f * DAY) / (5 * MINUTE)) * 5 * MINUTE));
      }}
    >
      {spans.map((s) => (
        <div
          key={s.start.getTime()}
          className={`phase ${s.phase}`}
          style={{
            left: pct(s.start),
            width: `${((s.end.getTime() - s.start.getTime() + MINUTE) / DAY) * 100}%`,
          }}
        />
      ))}
      {marks.map((m, i) => (
        <div key={i} className={`mark ${i === 0 ? 'start' : 'now'}`} style={{ left: pct(m) }} />
      ))}
      <div className="ticks">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {String(h % 24).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}
