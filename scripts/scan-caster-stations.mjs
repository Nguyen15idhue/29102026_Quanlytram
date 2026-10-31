#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('../server/node_modules/exceljs');

const HOST = process.env.CASTER_HOST || 'rtktk.online';
const PORTS = (process.env.CASTER_PORTS || '1509,1508')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const OUT_DIR = path.resolve(process.cwd(), process.env.OUT_DIR || 'db/data');
const RELAY_CONFIG = path.resolve(process.cwd(), process.env.RELAY_CONFIG || 'db/data/config.json');
const SCAN_TIME = new Date();

const REGION_BY_PREFIX = {
  THA: 'Thanh Hóa',
  SLA: 'Sơn La',
  YBI: 'Yên Bái',
  TNN: 'Thái Nguyên',
  BDH: 'Bình Định',
  HBH: 'Hòa Bình',
  GLI: 'Gia Lai',
  LCI: 'Lào Cai',
  BTE: 'Bến Tre',
  QBH: 'Quảng Bình',
  BKN: 'Bắc Kạn',
  KGG: 'Kiên Giang',
  TQG: 'Tuyên Quang',
  QNH: 'Quảng Ninh',
  CMU: 'Cà Mau',
  HUG: 'Hậu Giang',
  DTP: 'Đồng Tháp',
  PYN: 'Phú Yên',
  BG: 'Bắc Giang'
};

function fetchSourcetable(host, port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(buffer.toString('latin1'));
    };

    const timer = setTimeout(() => {
      if (buffer.includes('ENDSOURCETABLE')) finish();
      else finish(new Error(`timeout sau ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(
        `GET / HTTP/1.0\r\n` +
          `Host: ${host}\r\n` +
          `Ntrip-Version: Ntrip/2.0\r\n` +
          `User-Agent: NTRIP scan/1.0\r\n` +
          `Accept: */*\r\n` +
          `Connection: close\r\n\r\n`
      );
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 2_000_000) finish(new Error('response quá lớn'));
    });

    socket.on('end', () => finish());
    socket.on('close', () => finish());
    socket.on('error', (error) => finish(error));
  });
}

function parseSourcetable(text) {
  const start = text.indexOf('STR;');
  if (start < 0) return [];
  return text
    .slice(start)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('STR;'))
    .map((line) => {
      const parts = line.split(';');
      return {
        mountpoint: parts[1] || '',
        identifier: parts[2] || '',
        format_details: parts[3] || '',
        format: parts[4] || '',
        carrier: parts[5] || '',
        nav_system: parts[6] || '',
        network: parts[7] || '',
        country: parts[8] || '',
        lat_raw: parts[9] || '',
        lon_raw: parts[10] || '',
        nmea: parts[11] || '',
        solution: parts[12] || '',
        generator: parts[13] || '',
        compression: parts[14] || '',
        authentication: parts[15] || '',
        fee: parts[16] || '',
        bitrate: parts[17] || ''
      };
    })
    .filter((entry) => entry.mountpoint);
}

function sanitizeCode(name) {
  return name
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
}

function regionFor(name) {
  const prefix = name.split(/[_.-]/)[0]?.toUpperCase();
  return REGION_BY_PREFIX[prefix] || '';
}

function readRelayMounts() {
  if (!fs.existsSync(RELAY_CONFIG)) return { jobs: [], mounts: new Map() };
  const jobs = JSON.parse(fs.readFileSync(RELAY_CONFIG, 'utf8'));
  const mounts = new Map();

  for (const job of jobs) {
    for (const side of ['src', 'dst']) {
      const host = String(job[`${side}_host`] || '').toLowerCase();
      const port = Number(job[`${side}_port`]);
      const mount = String(job[`${side}_mount`] || '').trim();
      if (!mount || host !== HOST.toLowerCase() || !PORTS.includes(port)) continue;

      const key = mount.toLowerCase();
      const item = mounts.get(key) || {
        names: new Set(),
        ports: new Set(),
        jobs: new Set(),
        sides: new Set(),
        has_user: false
      };
      item.names.add(mount);
      item.ports.add(port);
      item.jobs.add(String(job.id));
      item.sides.add(side);
      if (side === 'src' && job.src_user && String(job.src_user).trim()) item.has_user = true;
      mounts.set(key, item);
    }
  }

  return { jobs, mounts };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeWorkbook(file, sheetName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach((column, index) => {
    column.width = Math.min(48, Math.max(14, headers[index].length + 4));
  });
  await workbook.xlsx.writeFile(file);
}

function diffKeys(left, right) {
  return [...left.keys()].filter((key) => !right.has(key)).sort();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const casterByKey = new Map();
  const casterByPort = new Map();

  for (const port of PORTS) {
    const text = await fetchSourcetable(HOST, port);
    fs.writeFileSync(path.join(OUT_DIR, `sourcetable_${port}.txt`), text, 'latin1');
    const entries = parseSourcetable(text);
    casterByPort.set(port, entries);

    for (const entry of entries) {
      const key = entry.mountpoint.toLowerCase();
      const item = casterByKey.get(key) || { names: new Set(), ports: new Set(), records: new Map() };
      item.names.add(entry.mountpoint);
      item.ports.add(port);
      item.records.set(port, entry);
      casterByKey.set(key, item);
    }
  }

  const { jobs, mounts: relayByKey } = readRelayMounts();
  const keys = [...new Set([...casterByKey.keys(), ...relayByKey.keys()])].sort((a, b) => a.localeCompare(b));

  const stations = [];
  const mountpoints = [];
  const usedCodes = new Map();

  for (const key of keys) {
    const caster = casterByKey.get(key);
    const relay = relayByKey.get(key);
    const canonical =
      (caster &&
        [...caster.records.keys()]
          .sort((a, b) => b - a)
          .map((port) => caster.records.get(port).mountpoint)[0]) ||
      (relay && [...relay.names].sort()[0]) ||
      key;

    const names = new Set([...(caster?.names || []), ...(relay?.names || [])]);
    const aliases = [...names].filter((name) => name !== canonical).sort();
    const casterPorts = [...(caster?.ports || [])].sort((a, b) => a - b);
    const relayPorts = [...(relay?.ports || [])].sort((a, b) => a - b);
    const ports = [...new Set([...casterPorts, ...relayPorts])].sort((a, b) => a - b);
    const relayJobs = [...(relay?.jobs || [])].sort();
    const primaryPort = ports.includes(1509) ? 1509 : ports[0];

    let code = sanitizeCode(canonical);
    const codeKey = code.toLowerCase();
    if (usedCodes.has(codeKey)) {
      const next = usedCodes.get(codeKey) + 1;
      usedCodes.set(codeKey, next);
      code = `${code}_${next}`.slice(0, 64);
    } else {
      usedCodes.set(codeKey, 1);
    }

    const notes = [
      `Quét sourcetable ${SCAN_TIME.toISOString().slice(0, 10)} (${PORTS.join('/')})`,
      caster ? `caster: ${casterPorts.join(',')}` : 'không thấy trong sourcetable, chỉ có trong relay config',
      relay ? `relay_jobs: ${relayJobs.join(',')}` : 'không có trong relay config',
      aliases.length ? `alias: ${aliases.join(',')}` : '',
      'toạ độ chờ 1005/1006; lat/lon sourcetable là 0.00 nên để trống'
    ]
      .filter(Boolean)
      .join('; ')
      .slice(0, 500);

    stations.push({
      code,
      name: canonical,
      station_type: 'reference',
      enabled: true,
      host: HOST,
      port: primaryPort,
      connection_type: 'ntrip',
      source_type: relay ? 'relay_caster' : 'caster_ingest',
      ntrip_version: 'v1',
      ntrip_mode: 'v1_auth',
      lat: null,
      lon: null,
      region: regionFor(canonical),
      address: '',
      contractor: '',
      receiver_type: '',
      receiver_sn: '',
      receiver_firmware: '',
      antenna_type: '',
      antenna_sn: '',
      antenna_height: null,
      elevation_mask: null,
      device_id: '',
      network_type: '',
      network_mode: '',
      protocol: 'ntrip',
      owner_username: '',
      notes,
      ports,
      caster_ports: casterPorts,
      relay_ports: relayPorts,
      relay_jobs: relayJobs,
      aliases,
      in_caster: Boolean(caster),
      in_relay: Boolean(relay)
    });

    mountpoints.push({
      mountpoint: canonical,
      station_code: code,
      ports,
      caster_ports: casterPorts,
      relay_ports: relayPorts,
      relay_jobs: relayJobs,
      aliases,
      in_caster: Boolean(caster),
      in_relay: Boolean(relay)
    });
  }

  const stationHeaders = [
    'code',
    'name',
    'station_type',
    'enabled',
    'host',
    'port',
    'connection_type',
    'source_type',
    'ntrip_version',
    'ntrip_mode',
    'lat',
    'lon',
    'region',
    'address',
    'contractor',
    'receiver_type',
    'receiver_sn',
    'receiver_firmware',
    'antenna_type',
    'antenna_sn',
    'antenna_height',
    'elevation_mask',
    'device_id',
    'network_type',
    'network_mode',
    'protocol',
    'owner_username',
    'notes'
  ];
  const stationRows = stations.map((station) =>
    stationHeaders.map((header) => (station[header] === null ? '' : station[header]))
  );
  const csvHeaders = [...stationHeaders, 'ports', 'caster_ports', 'relay_ports', 'relay_jobs', 'aliases'];
  const csvRows = stations.map((station) =>
    csvHeaders.map((header) => {
      const value = station[header];
      return Array.isArray(value) ? value.join(',') : value === null || value === undefined ? '' : value;
    })
  );

  fs.writeFileSync(path.join(OUT_DIR, 'caster_stations.csv'), '\uFEFF' + [csvHeaders, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'caster_mountpoints.csv'), '\uFEFF' + [
    ['mountpoint', 'station_code', 'ports', 'caster_ports', 'relay_ports', 'relay_jobs', 'aliases', 'in_caster', 'in_relay'],
    ...mountpoints.map((item) => [item.mountpoint, item.station_code, item.ports.join(','), item.caster_ports.join(','), item.relay_ports.join(','), item.relay_jobs.join(','), item.aliases.join(','), item.in_caster ? '1' : '0', item.in_relay ? '1' : '0'])
  ].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');

  fs.writeFileSync(
    path.join(OUT_DIR, 'caster_stations.json'),
    JSON.stringify(
      {
        scanned_at: SCAN_TIME.toISOString(),
        host: HOST,
        ports: PORTS,
        relay_config: RELAY_CONFIG,
        relay_jobs_total: jobs.length,
        stations,
        mountpoints
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  await writeWorkbook(path.join(OUT_DIR, 'caster_stations.xlsx'), 'Stations', stationHeaders, stationRows);
  await writeWorkbook(
    path.join(OUT_DIR, 'caster_mountpoints.xlsx'),
    'Mountpoints',
    ['mountpoint', 'station_code', 'ports', 'caster_ports', 'relay_ports', 'relay_jobs', 'aliases', 'in_caster', 'in_relay'],
    mountpoints.map((item) => [item.mountpoint, item.station_code, item.ports.join(','), item.caster_ports.join(','), item.relay_ports.join(','), item.relay_jobs.join(','), item.aliases.join(','), item.in_caster ? '1' : '0', item.in_relay ? '1' : '0'])
  );

  const relayOnly = diffKeys(relayByKey, casterByKey);
  const casterOnly = diffKeys(casterByKey, relayByKey);
  const caseAliases = stations.filter((station) => station.aliases.some((alias) => alias.toLowerCase() === station.name.toLowerCase()));
  const relayPortCounts = {};
  for (const port of PORTS) {
    const relayItems = [...relayByKey.values()].filter((item) => item.ports.has(port));
    const srcCount = [...relayByKey.values()].filter((item) => item.ports.has(port) && item.sides.has('src')).length;
    const dstCount = [...relayByKey.values()].filter((item) => item.ports.has(port) && item.sides.has('dst')).length;
    relayPortCounts[port] = { mounts: relayItems.length, src: srcCount, dst: dstCount };
  }

  const lines = [];
  lines.push(`# Quét caster ${HOST} — ${SCAN_TIME.toISOString()}`);
  lines.push('');
  lines.push('## Kết quả');
  lines.push('');
  lines.push('| Port | STR trong sourcetable | Mountpoint relay config | Relay src | Relay dst |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const port of PORTS) {
    lines.push(`| ${port} | ${casterByPort.get(port)?.length || 0} | ${relayPortCounts[port].mounts} | ${relayPortCounts[port].src} | ${relayPortCounts[port].dst} |`);
  }
  lines.push('');
  lines.push(`- Tổng station sau khi gộp (không phân biệt hoa/thường): **${stations.length}**.`);
  lines.push(`- Relay config hiện tại: **${jobs.length} job** (${jobs.filter((job) => job.enable).length} bật).`);
  lines.push(`- Station có trong sourcetable: **${stations.filter((station) => station.in_caster).length}**.`);
  lines.push(`- Station chỉ có trong relay config (chưa thấy ở sourcetable): **${relayOnly.length}** — ${relayOnly.map((key) => relayByKey.get(key).names.values().next().value).join(', ') || 'không'}.`);
  lines.push(`- Mountpoint chỉ có trong sourcetable (không có trong relay config): **${casterOnly.length}** — ${casterOnly.map((key) => casterByKey.get(key).names.values().next().value).join(', ') || 'không'}.`);
  lines.push(`- Cặp tên chỉ khác hoa/thường: **${caseAliases.length}** — ${caseAliases.map((station) => `${station.name} ↔ ${station.aliases.join('/')}`).join('; ') || 'không'}.`);
  lines.push('');
  lines.push('## Cảnh báo');
  lines.push('');
  lines.push('- Sourcetable trả `0.00` cho lat/lon; **không import 0,0**. Cột lat/lon trong file xlsx đang để trống, chờ 1005/1006 hoặc probe.');
  lines.push('- Sourcetable không yêu cầu auth, nhưng dữ liệu mountpoint có thể yêu cầu password; chưa kiểm tra credential.');
  lines.push('- `BG.TP` không hợp lệ làm `stations.code` (regex không cho dấu chấm) nên đã đổi thành `BG_TP`; mountpoint gốc vẫn là `BG.TP`.');
  lines.push('- Cột `region` được suy đoán từ tiền tố mountpoint (THA, SLA, YBI, ...), cần đối chiếu trước khi dùng chính thức.');
  lines.push('- `hauloc`, `MocChautest` là nghi vấn test/trùng; `TNN_TpThaiNguyen` và `TNN_TPThaiNguyen` đã gộp làm một station do MySQL so sánh code không phân biệt hoa/thường.');
  lines.push('- File `caster_stations.xlsx` chỉ tạo **trạm**; chưa tạo mountpoint/account/ACL. Cần script `importLegacyCaster` trước khi thiết bị có thể publish.');
  lines.push('');
  lines.push('## File sinh ra');
  lines.push('');
  for (const port of PORTS) lines.push(`- \`sourcetable_${port}.txt\` — raw response port ${port}`);
  lines.push('- `caster_stations.json` — dữ liệu đầy đủ (ports, relay job, alias).');
  lines.push('- `caster_stations.csv` — bản CSV để đối chiếu.');
  lines.push('- `caster_stations.xlsx` — import trực tiếp qua `/api/stations/import` (sheet `Stations`).');
  lines.push('- `caster_mountpoints.csv` / `.xlsx` — danh sách mountpoint cho bước tạo mountpoint sau.');
  fs.writeFileSync(path.join(OUT_DIR, 'caster_scan_summary.md'), lines.join('\n') + '\n', 'utf8');

  console.log(`Đã quét ${PORTS.join(', ')}: ${stations.length} station, ${mountpoints.length} mountpoint.`);
  console.log(`Relay-only: ${relayOnly.length}; caster-only: ${casterOnly.length}; case-alias: ${caseAliases.length}.`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
