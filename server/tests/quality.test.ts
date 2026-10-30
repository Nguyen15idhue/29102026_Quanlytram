import { describe, expect, it } from 'vitest';
import { UTF8_BOM, toCsv, csvBuffer } from '../src/lib/csv';
import { parseWindowMinutes, severityForLevel } from '../src/lib/quality';

describe('quality CSV export', () => {
  it('prefixes UTF-8 BOM', () => {
    const csv = toCsv(['a', 'b'], [[1, 2]]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csvBuffer(['a'], [['x']]).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('escapes commas, quotes and new lines', () => {
    const csv = toCsv(['name', 'note'], [['a,b', 'line "1"\nline2']]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"line ""1""\nline2"');
  });
});

describe('quality alert mapping helpers', () => {
  it('maps D49 levels to UI severity', () => {
    expect(severityForLevel('critical')).toBe('critical');
    expect(severityForLevel('major')).toBe('warning');
    expect(severityForLevel('minor')).toBe('info');
    expect(severityForLevel('info')).toBe('info');
  });

  it('clamps overview windows', () => {
    expect(parseWindowMinutes(undefined, 15)).toBe(15);
    expect(parseWindowMinutes('60')).toBe(60);
    expect(parseWindowMinutes('9999999')).toBe(1440);
    expect(parseWindowMinutes('-2')).toBe(15);
  });
});
