import { useEffect, useState } from 'react';
import { fmtTime } from '@odc/core';
import { usePath } from '../derived';
import { useView, type VideoFormat } from '../viewStore';
import { supportedFormats, type VideoQuality } from '../video/encoders';
import { renderFlight } from '../video/renderJob';
import { Field, Select } from './fields';

const RESOLUTIONS = [
  { value: '1280x720', label: '720p (1280×720)' },
  { value: '1920x1080', label: '1080p (1920×1080)' },
  { value: '2560x1440', label: '1440p (2560×1440)' },
  { value: '3840x2160', label: '4K UHD (3840×2160)' },
] as const;
type Resolution = (typeof RESOLUTIONS)[number]['value'];

const FORMATS: { value: VideoFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'gif', label: 'GIF (≤640 px, ≤15 fps)' },
];

export function RenderDialog({ onClose }: { onClose: () => void }) {
  const path = usePath();
  const [format, setFormat] = useState<VideoFormat>('mp4');
  const [res, setRes] = useState<Resolution>('1920x1080');
  const [fps, setFps] = useState('30');
  const [quality, setQuality] = useState<VideoQuality>('high');
  const [supported, setSupported] = useState<Set<VideoFormat>>();
  const [width, height] = res.split('x').map(Number) as [number, number];
  const frames = Math.round(path.duration * Number(fps));

  useEffect(() => {
    let alive = true;
    supportedFormats(width, height).then((s) => alive && setSupported(s));
    return () => {
      alive = false;
    };
  }, [width, height]);

  const unsupported = supported && !supported.has(format);
  const start = () => {
    onClose();
    // Watch the render on the camera view.
    useView.getState().setMain('camera');
    useView.getState().playTake(undefined);
    void renderFlight({ format, width, height, fps: Number(fps), quality });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Render flight video</h2>
        <p className="muted">
          Renders the drone camera frame by frame, waiting for terrain and 3D tiles on every frame.
          Output stays smooth and sharp no matter how fast this computer is.
        </p>
        <div className="grid2">
          <Field label="Format">
            <Select value={format} options={FORMATS} onChange={setFormat} />
          </Field>
          <Field label="Resolution">
            <Select value={res} options={[...RESOLUTIONS]} onChange={setRes} />
          </Field>
          <Field label="Frame rate">
            <Select
              value={fps}
              options={['24', '25', '30', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
              onChange={setFps}
            />
          </Field>
          <Field label="Quality">
            <Select<VideoQuality>
              value={quality}
              options={[
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'veryHigh', label: 'Very high' },
              ]}
              onChange={setQuality}
            />
          </Field>
        </div>
        <p className="stats">
          {fmtTime(path.duration)} · {frames} frames. The result opens as a take in the camera view.
        </p>
        {unsupported && (
          <p className="note">
            This system can't encode {format.toUpperCase()} at this size. Try another format or a
            lower resolution.
          </p>
        )}
        <div className="button-row end">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!supported || unsupported || frames === 0}
            onClick={start}
          >
            Render
          </button>
        </div>
      </div>
    </div>
  );
}
