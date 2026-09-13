import { describe, expect, it } from 'vitest';
import { barEvents, expandClickTrack, sectionSpans, type ClickTrack } from '../src/core/rhythm';

describe('barEvents', () => {
  it('4/4 at 120 with eighths', () => {
    const ev = barEvents({ bpm: 120, beatsPerBar: 4, beatUnit: 4, subdivision: 2 });
    expect(ev).toHaveLength(8);
    expect(ev.map((e) => e.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    expect(ev[0].level).toBe('accent');
    expect(ev[1].level).toBe('sub');
    expect(ev[2].level).toBe('normal');
  });

  it('silent beats silence their subdivisions', () => {
    const ev = barEvents({ bpm: 60, beatsPerBar: 2, beatUnit: 4, subdivision: 3, accents: ['accent', 'silent'] });
    expect(ev.slice(3).every((e) => e.level === 'silent')).toBe(true);
  });
});

describe('expandClickTrack', () => {
  it('count-in then constant section', () => {
    const track: ClickTrack = {
      id: 't',
      name: 't',
      countInBars: 1,
      sections: [{ bars: 2, bpm: 60, beatsPerBar: 3, beatUnit: 4, subdivision: 1 }],
    };
    const { events, duration } = expandClickTrack(track);
    expect(events).toHaveLength(9);
    expect(events.slice(0, 3).every((e) => e.countIn)).toBe(true);
    expect(events[3].time).toBe(3);
    expect(events[3].bar).toBe(0);
    expect(duration).toBe(9);
  });

  it('meter and tempo changes across sections', () => {
    const track: ClickTrack = {
      id: 't',
      name: 't',
      countInBars: 0,
      sections: [
        { bars: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4, subdivision: 1 },
        { bars: 1, bpm: 60, beatsPerBar: 2, beatUnit: 4, subdivision: 1 },
      ],
    };
    const { events, duration } = expandClickTrack(track);
    expect(events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5, 2, 3]);
    expect(events[4].section).toBe(1);
    expect(duration).toBe(4);
  });

  it('linear ramp hits start and end tempo', () => {
    const track: ClickTrack = {
      id: 't',
      name: 't',
      countInBars: 0,
      sections: [{ bars: 2, bpm: 60, endBpm: 120, beatsPerBar: 4, beatUnit: 4, subdivision: 1 }],
    };
    const { events } = expandClickTrack(track);
    expect(events[0].bpm).toBe(60);
    expect(events[7].bpm).toBe(120);
    const gaps = events.slice(1).map((e, i) => e.time - events[i].time);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
  });
});

describe('sectionSpans', () => {
  it('gives section boundaries after the count-in', () => {
    const track: ClickTrack = {
      id: 't',
      name: 't',
      countInBars: 1,
      sections: [
        { bars: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4, subdivision: 1 },
        { bars: 2, bpm: 60, beatsPerBar: 2, beatUnit: 4, subdivision: 2 },
      ],
    };
    const { spans, countIn, duration } = sectionSpans(track);
    expect(countIn).toBe(2);
    expect(spans).toEqual([
      { section: 0, start: 2, end: 4 },
      { section: 1, start: 4, end: 8 },
    ]);
    expect(duration).toBe(8);
  });
});
