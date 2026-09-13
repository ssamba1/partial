import { micFailure, type MicFailureReason } from '../core/mic';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const stateListeners = new Set<(state: AudioContextState | 'interrupted') => void>();

/**
 * Limiter settings for the master bus: clicks, poly, subdivisions and drones can
 * stack past full scale, so peaks are held just under it instead of clipping.
 */
export const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };

/** Called when the audio context is suspended, interrupted (a phone call) or resumes. */
export function onContextState(fn: (state: AudioContextState | 'interrupted') => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}
let micStream: MediaStream | null = null;
let micUsers = 0;
let micPending: Promise<MediaStream> | null = null;

export function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    const c = ctx;
    c.addEventListener('statechange', () => stateListeners.forEach((fn) => fn(c.state as AudioContextState | 'interrupted')));
  }
  return ctx;
}

export function getMaster(): GainNode {
  getContext();
  return master!;
}

/** Must be called from a user gesture on first use (browser autoplay policy). */
export async function ensureRunning(): Promise<AudioContext> {
  const c = getContext();
  // Ask for a media playback session where supported (Safari), so the click is not treated as ambient
  // sound. Whether this overrides the iPhone silent switch is untested here.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session && session.type !== 'playback') {
    try {
      session.type = 'playback';
    } catch {
      // Read-only or unsupported value: leave it.
    }
  }
  if (c.state !== 'running') await c.resume();
  return c;
}

export class MicError extends Error {
  constructor(message: string, readonly reason: MicFailureReason) {
    super(message);
  }
}

export interface MicRequest {
  /** Input device to open; empty or missing for the browser default. */
  deviceId?: string;
  /** Ask for two channels, for picking one input of a stereo interface. */
  stereo?: boolean;
}

function micConstraints(req: MicRequest, withDevice: boolean): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...(req.stereo ? { channelCount: { ideal: 2 } } : {}),
    ...(withDevice && req.deviceId ? { deviceId: { exact: req.deviceId } } : {}),
  };
}

/**
 * Shared microphone stream, reference counted so views can start and stop
 * independently. The request only applies when the stream is opened; a caller
 * joining an open stream gets that stream.
 */
export async function acquireMic(req: MicRequest = {}): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new MicError('The microphone needs a secure (https or localhost) page.', 'insecure');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError('This browser does not provide microphone access.', 'unavailable');
  }
  if (!micStream || micStream.getAudioTracks().every((t) => t.readyState === 'ended')) {
    // Share one in-flight request so two callers starting at once get the same stream.
    micPending ??= navigator.mediaDevices
      .getUserMedia({ audio: micConstraints(req, true) })
      .catch((err) => {
        // A saved device that is unplugged or renamed: fall back to the default input.
        const name = (err as DOMException)?.name;
        if (req.deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
          return navigator.mediaDevices.getUserMedia({ audio: micConstraints(req, false) });
        }
        throw err;
      })
      .then((s) => (micStream = s))
      .catch((err) => {
        const failure = micFailure((err as DOMException)?.name);
        throw new MicError(failure.message, failure.reason);
      })
      .finally(() => (micPending = null));
    await micPending;
  }
  micUsers++;
  return micStream!;
}

/** The open microphone track, if any. */
export function currentMicTrack(): MediaStreamTrack | null {
  return micStream?.getAudioTracks()[0] ?? null;
}

export function releaseMic(): void {
  micUsers = Math.max(0, micUsers - 1);
  if (micUsers === 0 && micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}
