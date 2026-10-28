import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { VideoFormat } from '../viewStore';

export type VideoQuality = 'medium' | 'high' | 'veryHigh';

export interface FrameEncoder {
  /** Capture the canvas as frame `index`. Call right after rendering it. */
  addFrame(index: number): Promise<void>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
  /** Bytes produced so far, for the live REC overlay. */
  readonly bytes: number;
  /** Frames per second actually written (GIFs drop frames to stay small). */
  readonly fps: number;
}

const CODECS: Record<'mp4' | 'webm', VideoCodec[]> = {
  mp4: ['avc', 'hevc'],
  webm: ['vp9', 'vp8'],
};

const QUALITY = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, veryHigh: QUALITY_VERY_HIGH };

/** Which formats this machine can encode at the given size (WebCodecs support varies by OS). */
export async function supportedFormats(width: number, height: number): Promise<Set<VideoFormat>> {
  const out = new Set<VideoFormat>(['gif']);
  if (typeof VideoEncoder === 'undefined') return out;
  for (const f of ['mp4', 'webm'] as const) {
    for (const codec of CODECS[f]) {
      if (await canEncodeVideo(codec, { width, height }).catch(() => false)) {
        out.add(f);
        break;
      }
    }
  }
  return out;
}

export async function createEncoder(
  format: VideoFormat,
  canvas: HTMLCanvasElement,
  opts: { fps: number; quality: VideoQuality },
): Promise<FrameEncoder> {
  return format === 'gif'
    ? createGifEncoder(canvas, opts.fps)
    : createVideoEncoder(format, canvas, opts);
}

async function createVideoEncoder(
  format: 'mp4' | 'webm',
  canvas: HTMLCanvasElement,
  opts: { fps: number; quality: VideoQuality },
): Promise<FrameEncoder> {
  let codec: VideoCodec | undefined;
  for (const c of CODECS[format]) {
    if (await canEncodeVideo(c, { width: canvas.width, height: canvas.height })) {
      codec = c;
      break;
    }
  }
  if (!codec) throw new Error(`This system cannot encode ${format.toUpperCase()} video.`);

  const output = new Output({
    format:
      format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  let bytes = 0;
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: QUALITY[opts.quality],
    keyFrameInterval: 2,
    onEncodedPacket: (packet) => {
      bytes += packet.data.byteLength;
    },
  });
  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();
  const mime = format === 'mp4' ? 'video/mp4' : 'video/webm';

  return {
    fps: opts.fps,
    get bytes() {
      return bytes;
    },
    addFrame: (i) => source.add(i / opts.fps, 1 / opts.fps),
    async finish() {
      await output.finalize();
      return new Blob([output.target.buffer!], { type: mime });
    },
    cancel: () => output.cancel(),
  };
}

/** GIFs are capped at 640 px wide and 15 fps to keep files shareable. */
function createGifEncoder(canvas: HTMLCanvasElement, fps: number): FrameEncoder {
  const step = Math.max(1, Math.round(fps / 15));
  const gifFps = fps / step;
  const scale = Math.min(1, 640 / canvas.width);
  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();

  return {
    fps: gifFps,
    get bytes() {
      return gif.bytesView().length;
    },
    async addFrame(i) {
      if (i % step !== 0) return;
      ctx.drawImage(canvas, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay: 1000 / gifFps });
      // Yield so the UI can update between frames.
      await new Promise((r) => setTimeout(r, 0));
    },
    async finish() {
      gif.finish();
      return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
    },
    async cancel() {},
  };
}
