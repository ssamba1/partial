export type MidiAction = 'next' | 'previous' | 'toggle' | 'metronome' | 'tap';

export const MIDI_ACTIONS: { id: MidiAction; label: string }[] = [
  { id: 'next', label: 'Next page' },
  { id: 'previous', label: 'Previous page' },
  { id: 'toggle', label: 'Start / stop' },
  { id: 'metronome', label: 'Metronome on / off' },
  { id: 'tap', label: 'Tap tempo' },
];

/**
 * Turns a raw MIDI message into a trigger key, or null if it is not a "press".
 * Note on (velocity > 0) -> "note:<n>", control change with value >= 64 -> "cc:<n>".
 * Channel is ignored so a pedal works on any channel.
 */
export function midiTrigger(data: ArrayLike<number>): string | null {
  if (data.length < 3) return null;
  const type = data[0] & 0xf0;
  if (type === 0x90 && data[2] > 0) return `note:${data[1]}`;
  if (type === 0xb0 && data[2] >= 64) return `cc:${data[1]}`;
  return null;
}

/** Human label for a trigger key. */
export function triggerLabel(key: string): string {
  const [kind, n] = key.split(':');
  return kind === 'note' ? `Note ${n}` : `Controller ${n}`;
}
