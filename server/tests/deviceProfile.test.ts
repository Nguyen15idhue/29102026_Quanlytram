import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deviceSeed,
  deviceUserAgent,
  deviceVersion,
  fnv1a64,
  type DeviceVersionTemplate
} from '../src/lib/deviceProfile';

interface Vector {
  code: string;
  targetId: number;
  role: 'relay' | 'station' | 'probe';
  seed: string;
  prefix: string;
  version: string;
  userAgent: string;
}

const vectors = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../gnss/internal/deviceprofile/testdata/device-profile-vectors.json'
    ),
    'utf8'
  )
).vectors as Vector[];

const templates: Record<string, { name: string; template: DeviceVersionTemplate }> = {
  gnss_internet_radio: { name: 'GNSSInternetRadio', template: 'major.minor.patch' },
  efix_efield: { name: 'EFIX eField', template: 'major.minor.patch.date' },
  chc_landstar: { name: 'CHC LandStar', template: 'major.minor.patch.date' },
  chc_i83: { name: 'CHC i83', template: 'major.minor.patch' },
  comnav_t300: { name: 'COMNAV T300', template: 'major.minor.patch' },
  trimble_da2: { name: 'Trimble DA2', template: 'major.minor' },
  hitarget_v90: { name: 'Hi-Target V90', template: 'major.minor.patch' },
  south_s82t: { name: 'South S82T', template: 'major.minor.patch' },
  stonex_s900a: { name: 'Stonex S900A', template: 'major.minor.patch' },
  unistrong_g970: { name: 'UniStrong G970', template: 'major.minor.patch' },
  emlid_reachrs2: { name: 'Emlid ReachRS2', template: 'vmajor.minor.patch' },
  leica_gs18: { name: 'Leica GS18', template: 'major.minor.patch' }
};

describe('device profile UA vectors (Go/Node parity)', () => {
  it('FNV-1a 64-bit khớp vector seed', () => {
    const seed = deviceSeed('chc_landstar', 3, 'relay');
    expect(seed.toString()).toBe(vectors.find((v) => v.code === 'chc_landstar' && v.targetId === 3)!.seed);
    expect(fnv1a64('relay')).toBeGreaterThan(0n);
  });

  it.each(vectors)('$code/$role/$targetId sinh đúng UA', (vector) => {
    const profile = templates[vector.code];
    expect(profile, `thiếu mapping cho ${vector.code}`).toBeTruthy();
    const seed = deviceSeed(vector.code, vector.targetId, vector.role);
    expect(seed.toString()).toBe(vector.seed);
    const full = { code: vector.code, name: profile.name, versionTemplate: profile.template };
    expect(deviceVersion(full, seed)).toBe(vector.version);
    expect(deviceUserAgent(full, vector.prefix, vector.role, vector.targetId)).toBe(
      vector.userAgent
    );
  });

  it('không sinh hậu tố nội bộ và tôn trọng giới hạn 255 ký tự', () => {
    const profile = templates.chc_landstar;
    const ua = deviceUserAgent(
      { code: 'chc_landstar', ...profile },
      'X'.repeat(200),
      'station',
      7
    );
    expect(ua.length).toBeLessThanOrEqual(255);
    for (const banned of ['-relay', '-station', '-probe', 'CORS-MVP']) {
      expect(ua.includes(banned)).toBe(false);
    }
  });
});
