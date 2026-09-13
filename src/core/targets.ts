import { stringFrequency, type StringInstrument } from './instruments';
import { midiToFrequency, type TuningSystem } from './notes';

/**
 * What a reading was measured against, kept symbolically (a note, a string, a
 * partial) so its frequency can be worked out again under the current tuning.
 */
export type TargetSpec =
  | { kind: 'note'; midi: number }
  | { kind: 'string'; index: number }
  | { kind: 'partial'; n: number }
  | { kind: 'hz'; hz: number };

export interface TargetContext {
  tuning: TuningSystem;
  /** Concert MIDI note of the partials mode fundamental. */
  partialFundamental: number;
  instrument: StringInstrument;
  pureFifths: boolean;
}

export function targetFrequency(spec: TargetSpec, ctx: TargetContext): number {
  switch (spec.kind) {
    case 'note':
      return midiToFrequency(spec.midi, ctx.tuning);
    case 'string':
      return stringFrequency(ctx.instrument, Math.min(spec.index, ctx.instrument.strings.length - 1), ctx.tuning, ctx.pureFifths);
    case 'partial':
      return spec.n * midiToFrequency(ctx.partialFundamental, ctx.tuning);
    case 'hz':
      return spec.hz;
  }
}
