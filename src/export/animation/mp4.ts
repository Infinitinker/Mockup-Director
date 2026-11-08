/**
 * MP4 (H.264 / AVC) export: frames are encoded with WebCodecs' VideoEncoder (hardware where
 * available) and muxed with mediabunny (MPL-2.0, loaded on demand – only when an MP4 is exported).
 *
 * Availability: Chromium / WebView2 and Safari 16.4+ (macOS 13.3+). On older WebKit (macOS 12)
 * there is no VideoEncoder – the UI hides MP4 and explains why.
 */

/** Bits per pixel per frame for the quality presets (≈ 7.5 Mbit/s for 1080p30 at 'medium'). */
const BPP: Record<'low' | 'medium' | 'high', number> = { low: 0.06, medium: 0.12, high: 0.22 };

/** H.264 levels: [level_idc, MaxFS (macroblocks), MaxMBPS (macroblocks/s)]. */
const LEVELS: [number, number, number][] = [
  [0x1f, 3600, 108000], // 3.1
  [0x20, 5120, 216000], // 3.2
  [0x28, 8192, 245760], // 4.0
  [0x2a, 8704, 522240], // 4.2
  [0x32, 22080, 589824], // 5.0
  [0x33, 36864, 983040], // 5.1
  [0x34, 36864, 2073600], // 5.2
];
/** profile_idc + constraint flags: High, Main, Constrained Baseline, Baseline. */
const PROFILES = ['6400', '4d00', '42e0', '4200'];

/** Is WebCodecs video encoding present at all? (Config support is checked per export.) */
export function mp4EncodingAvailable(): boolean {
  return (
    typeof VideoEncoder === 'function' && typeof VideoFrame === 'function' && typeof EncodedVideoChunk === 'function'
  );
}

export function bitrateFor(width: number, height: number, fps: number, quality: 'low' | 'medium' | 'high'): number {
  const bps = width * height * fps * (BPP[quality] ?? BPP.medium);
  return Math.round(Math.min(50_000_000, Math.max(400_000, bps)));
}

/** Codec strings to try for a size / fps, the lowest sufficient level first. */
export function avcCandidates(width: number, height: number, fps: number): string[] {
  const mbw = Math.ceil(width / 16);
  const mbh = Math.ceil(height / 16);
  const fs = mbw * mbh;
  const mbps = fs * fps;
  const fits = LEVELS.filter(
    ([, maxFs, maxMbps]) => fs <= maxFs && mbps <= maxMbps && Math.max(mbw, mbh) <= Math.sqrt(maxFs * 8),
  );
  const levels = fits.length ? fits : [LEVELS[LEVELS.length - 1]];
  const out: string[] = [];
  for (const [level] of levels) for (const p of PROFILES) out.push(`avc1.${p}${level.toString(16).padStart(2, '0')}`);
  return out;
}

/** Find a supported encoder configuration (null = H.264 encoding unsupported for this size). */
export async function findAvcConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoEncoderConfig | null> {
  if (!mp4EncodingAvailable()) return null;
  for (const codec of avcCandidates(width, height, fps)) {
    const base: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' };
    for (const cfg of [{ ...base, avc: { format: 'avc' as const } }, base]) {
      try {
        const res = await VideoEncoder.isConfigSupported(cfg);
        if (res.supported) return { ...cfg, ...(res.config ?? {}) } as VideoEncoderConfig;
      } catch {
        /* invalid for this engine – try the next one */
      }
    }
  }
  return null;
}

/** Streams canvases into an H.264 MP4 file. Create with Mp4Writer.create(). */
export class Mp4Writer {
  private failure: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private frames = 0;
  private closed = false;

  private constructor(
    private readonly encoder: VideoEncoder,
    private readonly output: { finalize(): Promise<void>; cancel(): Promise<void> },
    private readonly target: { buffer: ArrayBuffer | null },
    private readonly fps: number,
    private readonly keyEvery: number,
  ) {}

  /** null = this engine cannot encode H.264 at this size. */
  static async create(
    width: number,
    height: number,
    fps: number,
    quality: 'low' | 'medium' | 'high',
  ): Promise<Mp4Writer | null> {
    const config = await findAvcConfig(width, height, fps, bitrateFor(width, height, fps, quality));
    if (!config) return null;
    const mb = await import('mediabunny');
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new mb.EncodedVideoPacketSource('avc');
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();

    let writer: Mp4Writer | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const w = writer!;
        // Packets must reach the muxer in decode order – chain the (async) adds.
        w.chain = w.chain
          .then(() => source.add(mb.EncodedPacket.fromEncodedChunk(chunk), meta))
          .catch((e: unknown) => {
            w.failure ??= e;
          });
      },
      error: (e) => {
        if (writer) writer.failure ??= e;
      },
    });
    encoder.configure(config);
    writer = new Mp4Writer(encoder, output, target, fps, Math.max(1, Math.round(fps * 2)));
    return writer;
  }

  /** Encode one frame (an opaque canvas of the configured size). Respects encoder backpressure. */
  async addFrame(canvas: HTMLCanvasElement): Promise<void> {
    this.throwIfFailed();
    const i = this.frames++;
    const timestamp = Math.round((i * 1_000_000) / this.fps);
    const duration = Math.round(((i + 1) * 1_000_000) / this.fps) - timestamp;
    const frame = new VideoFrame(canvas, { timestamp, duration, alpha: 'discard' });
    try {
      this.encoder.encode(frame, { keyFrame: i % this.keyEvery === 0 });
    } finally {
      frame.close();
    }
    // Keep only a few frames in flight (memory + responsiveness).
    while (this.encoder.encodeQueueSize > 3 && !this.failure) {
      await new Promise<void>((resolve) => setTimeout(resolve, 4));
    }
    this.throwIfFailed();
  }

  /** Flush the encoder, finish the file and return it. */
  async finish(): Promise<Blob> {
    this.throwIfFailed();
    await this.encoder.flush();
    await this.chain;
    this.throwIfFailed();
    this.closeEncoder();
    await this.output.finalize();
    const buf = this.target.buffer;
    if (!buf) throw new Error('MP4 muxer produced no data');
    return new Blob([buf], { type: 'video/mp4' });
  }

  /** Abort (cancel / error). Safe to call more than once. */
  async cancel(): Promise<void> {
    this.closeEncoder();
    try {
      await this.output.cancel();
    } catch {
      /* already finished or cancelled */
    }
  }

  private closeEncoder(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      /* ignore */
    }
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure instanceof Error ? this.failure : new Error(String(this.failure));
  }
}
