import { afterEach, describe, expect, it } from 'vitest';
import { helmholtz, midiToFrequency, noteName, octaveText, SCALA_TEMPERAMENTS, setNotation, spellWithFlats, temperamentOffset, TRANSPOSITIONS, transpose, withOctave } from '../src/core/notes';
import { bellPartial, edoNames, edoReading, HALF_FLAT, HALF_SHARP, lockOffset, nearestCaptured, parseScala, pitchClassMidiNear, scalaToTwelve, shrutiName, svaraReading } from '../src/core/scales';
import { mergeSettings, tuningOf } from '../src/store/settings';

afterEach(() => setNotation('english', 0, 'scientific'));

describe('Scala import and more temperaments (01-81)', () => {
  const kirnberger = `! kirnberger.scl
!
Kirnberger's well-temperament, also called Kirnberger III, letter to Forkel 1779
 12
!
 256/243
 193.15686
 32/27
 5/4
 4/3
 45/32
 696.57843
 128/81
 889.73529
 16/9
 15/8
 2/1
`;
  it('reads ratios, cents, comments and the implied 1/1', () => {
    const s = parseScala(kirnberger);
    expect(typeof s).toBe('object');
    if (typeof s === 'string') return;
    expect(s.description).toContain('Kirnberger III');
    const twelve = scalaToTwelve(s)!;
    expect(twelve[0]).toBe(0);
    expect(twelve[4]).toBeCloseTo(386.31, 2);
    // Matches the built-in table taken from the same file.
    twelve.forEach((c, i) => expect(c).toBeCloseTo(SCALA_TEMPERAMENTS.kirnberger3[i], 1));
  });

  it('reads a bare integer as a ratio and reports bad files', () => {
    const s = parseScala('x\n2\n3/2\n2\n');
    expect(typeof s !== 'string' && s.cents[1]).toBe(1200);
    expect(typeof parseScala('x\n3\n1.0\n')).toBe('string');
    expect(scalaToTwelve(s as never)).toBeNull();
  });

  it('uses an imported scale as the custom temperament', () => {
    const cents = SCALA_TEMPERAMENTS.kellner;
    expect(temperamentOffset('custom', 4, { customCents: cents })).toBeCloseTo(-10.95, 2);
    const s = mergeSettings({ temperament: 'custom', customScale: { name: 'k', cents }, temperamentAnchor: 'tonic' } as never);
    expect(midiToFrequency(64, tuningOf(s)) / midiToFrequency(60, tuningOf(s))).toBeCloseTo(Math.pow(2, 389.05 / 1200), 6);
  });
});

describe('equal divisions (01-82, 01-83)', () => {
  it('spells 19, 24 and 31 from the chain of fifths', () => {
    expect(edoNames(19).slice(0, 4)).toEqual(['C', 'C♯', 'D♭', 'D']);
    const q = edoNames(24);
    expect(q[1]).toBe(`C${HALF_SHARP}`);
    expect(q[2]).toBe('C♯');
    expect(q[3]).toBe(`D${HALF_FLAT}`);
    expect(edoNames(31)[5]).toBe('D');
    expect(new Set(edoNames(24)).size).toBe(24);
  });

  it('reads a quarter tone above A4 in 24-EDO as its own step', () => {
    const r = edoReading(440 * Math.pow(2, 50 / 1200) * Math.pow(2, 3 / 1200), 440, 24);
    expect(edoNames(24)[r.step]).toBe(`A${HALF_SHARP}`);
    expect(r.octave).toBe(4);
    expect(r.cents).toBeCloseTo(3, 6);
  });
});

describe('Sa as a frequency (01-84)', () => {
  it('finds Pa at 3/2 of Sa and other shrutis', () => {
    const pa = svaraReading(219, 146);
    expect(shrutiName(pa.index)).toBe('Pa');
    expect(pa.cents).toBeCloseTo(0, 6);
    expect(shrutiName(svaraReading(146 * 2 * 1.25, 146).index)).toBe('Ga');
    expect(svaraReading(146 * 2 * 1.25, 146).octave).toBe(1);
    expect(shrutiName(svaraReading(146 * (16 / 15), 146).index)).toBe('R12');
  });
});

describe('captured scale (01-85)', () => {
  it('tunes to the nearest captured note in any octave', () => {
    const notes = [{ hz: 261, label: '1' }, { hz: 294, label: '2' }];
    const r = nearestCaptured(588 * Math.pow(2, 10 / 1200), notes)!;
    expect(r.index).toBe(1);
    expect(r.octave).toBe(1);
    expect(r.cents).toBeCloseTo(10, 6);
    expect(nearestCaptured(440, [])).toBeNull();
  });
});

describe('transpositions (01-86)', () => {
  const semis = (id: string) => TRANSPOSITIONS.find((t) => t.id === id)!.semitones;
  it('keeps the octave: concert B♭3 on tenor sax is written C5', () => {
    expect(noteName(transpose(58, semis('Bb9')))).toBe('C5');
    expect(noteName(transpose(58, semis('Bb')))).toBe('C4');
    expect(noteName(transpose(61, semis('Eb13')))).toBe('A#5');
    expect(noteName(transpose(72, semis('C8va')))).toBe('C4');
    expect(noteName(transpose(60, semis('EbHigh')))).toBe('A3');
  });
  it('drops unknown stored ids back to concert pitch', () => {
    expect(mergeSettings({ transposition: 'nope' } as never).transposition).toBe('C');
  });
});

describe('spelling by key (01-88)', () => {
  it('uses flats in flat keys only', () => {
    expect(spellWithFlats('key', 5)).toBe(true);
    expect(spellWithFlats('key', 7)).toBe(false);
    expect(spellWithFlats('flats', 7)).toBe(true);
    expect(mergeSettings({ spelling: 'key', tonic: 3 } as never).flats).toBe(true);
    // Written key for a B♭ instrument: concert E♭ is written F, a flat key.
    expect(mergeSettings({ spelling: 'key', tonic: 3, transposition: 'Bb' } as never).flats).toBe(true);
    // Concert A on a B♭ instrument is written B, a sharp key.
    expect(mergeSettings({ spelling: 'key', tonic: 9, transposition: 'Bb' } as never).flats).toBe(false);
    expect(mergeSettings({ flats: true } as never).spelling).toBe('flats');
  });
});

describe('note names (01-89)', () => {
  it('German uses Cis, Es, As, B and H', () => {
    expect(noteName(61, false, false, 'german')).toBe('Cis');
    expect(noteName(63, true, false, 'german')).toBe('Es');
    expect(noteName(68, true, false, 'german')).toBe('As');
    expect(noteName(70, true, false, 'german')).toBe('B');
    expect(noteName(71, false, false, 'german')).toBe('H');
  });
  it('Italian and movable do', () => {
    expect(noteName(62, false, false, 'italian')).toBe('Re');
    expect(noteName(67, false, false, 'movable', 7)).toBe('Do');
    expect(noteName(66, false, false, 'movable', 7)).toBe('Ti');
    expect(noteName(70, true, false, 'movable', 0)).toBe('Te');
  });
  it('Helmholtz octaves', () => {
    expect(helmholtz('C', 4)).toBe('c′');
    expect(helmholtz('C', 3)).toBe('c');
    expect(helmholtz('C', 2)).toBe('C');
    expect(helmholtz('C', 1)).toBe('C͵');
    setNotation('german', 0, 'helmholtz');
    expect(noteName(61)).toBe('cis′');
    expect(octaveText(48)).toBe('');
    expect(withOctave('A', 69)).toBe('a′');
    setNotation('solfege', 0, 'helmholtz');
    expect(noteName(60)).toBe('Do4');
  });
});

describe('note lock (01-90)', () => {
  it('shows semitones and cents away from a locked note', () => {
    expect(lockOffset(440 * Math.pow(2, -288 / 1200), 440).text).toBe('−3 st +12¢');
    expect(lockOffset(441, 440).text).toBe('+4¢');
    expect(pitchClassMidiNear(0, 69)).toBe(72);
    expect(pitchClassMidiNear(4, 69)).toBe(64);
  });
});

describe('bell partials (01-92)', () => {
  it('names hum, prime, tierce, quint from the nominal', () => {
    expect(bellPartial(250, 1000)!.name).toBe('hum');
    expect(bellPartial(500, 1000)!.name).toBe('prime');
    expect(bellPartial(1000 * Math.pow(2, -905 / 1200), 1000)).toEqual({ name: 'tierce', error: expect.closeTo(-5, 6) });
    expect(bellPartial(1000 * Math.pow(2, -700 / 1200), 1000)).toBeNull();
  });
});
