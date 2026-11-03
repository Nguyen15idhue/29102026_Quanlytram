import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  buildPlan,
  coordinateFor,
  parseCsvLine,
  stationCodeFromMountpoint,
  summarizePlan
} from '../src/db/importLegacyV2';

const DATA = join(__dirname, '..', '..', 'db', 'data');

describe('importLegacyV2', () => {
  it('chuẩn hoá mã trạm và toạ độ giả định', () => {
    expect(stationCodeFromMountpoint('BG.TP')).toBe('BG_TP');
    expect(coordinateFor('BG_TP')).toEqual([21.27, 106.2]);
    expect(coordinateFor('HAULOC')).toEqual([19.93, 105.75]);
    expect(coordinateFor('UNKNOWN_X')).toBeNull();
  });

  it('parse CSV có dấu phẩy trong ngoặc kép', () => {
    expect(parseCsvLine('a,"1508,1509",b')).toEqual(['a', '1508,1509', 'b']);
  });

  it('dựng kế hoạch đúng số lượng và mapping port', () => {
    const plan = buildPlan(DATA);
    const summary = summarizePlan(plan);

    expect(summary.stations).toBe(36);
    expect(summary.mountpoints).toBe(31);
    expect(summary.mountpointPorts['1509']).toBe(26);
    expect(summary.mountpointPorts['1508']).toBe(6);
    expect(summary.relays).toBe(67);
    expect(summary.relaysImportDisabled).toBe(67);
    expect(summary.accounts.map((account) => account.username).sort()).toEqual([
      'admin',
      'aitogy123',
      'nguyen'
    ]);
    expect(summary.accounts.every((account) => account.hasPassword)).toBe(true);
  });

  it('gắn toạ độ cho mọi trạm và không lộ mật khẩu trong summary', () => {
    const plan = buildPlan(DATA);
    expect(plan.stations.every((station) => station.lat !== null && station.lon !== null)).toBe(true);
    const summary = JSON.stringify(summarizePlan(plan));
    expect(summary).not.toContain('"password"');
    for (const account of plan.accounts) {
      if (account.password && account.password !== account.username) {
        expect(summary).not.toContain(account.password);
      }
    }
  });
});
