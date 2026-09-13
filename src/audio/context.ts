let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let micStream: MediaStream | null = null;
let micUsers = 0;
let micPending: Promise<MediaStream> | null = null;

export function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.connect(ctx.destination);
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
  if (c.state !== 'running') await c.resume();
  return c;
}

export class MicError extends Error {
  constructor(message: string, readonly reason: 'denied' | 'unavailable' | 'insecure') {
    super(message);
  }
}

/** Shared microphone stream, reference counted so views can start and stop independently. */
export async function acquireMic(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new MicError('The microphone needs a secure (https or localhost) page.', 'insecure');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError('This browser does not provide microphone access.', 'unavailable');
  }
  if (!micStream || micStream.getAudioTracks().every((t) => t.readyState === 'ended')) {
    // Share one in-flight request so two callers starting at once get the same stream.
    micPending ??= navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => (micStream = s))
      .catch((err) => {
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw new MicError('Microphone permission was denied. Allow it in the browser and try again.', 'denied');
        }
        throw new MicError('No microphone could be opened.', 'unavailable');
      })
      .finally(() => (micPending = null));
    await micPending;
  }
  micUsers++;
  return micStream!;
}

export function releaseMic(): void {
  micUsers = Math.max(0, micUsers - 1);
  if (micUsers === 0 && micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}
