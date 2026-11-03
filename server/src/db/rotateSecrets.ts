import { config } from '../config';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { relayCredentialAad } from '../lib/relayCredentials';
import { closePool, query, withTransaction } from './pool';

/**
 * Rotate secret v1 → v2 (gắn AAD theo bản ghi) cho các cột đã có read-path
 * hỗ trợ. Mặc định dry-run; chỉ ghi DB khi truyền `--apply`.
 *
 * Thứ tự triển khai bắt buộc: deploy read-path (lô D) trước, backup DB, rồi
 * mới chạy `--apply`.
 */

interface RotationTarget {
  label: string;
  table: string;
  column: string;
  idColumn: string;
  aad: (id: number) => string;
}

export const ROTATION_TARGETS: RotationTarget[] = [
  {
    label: 'relay_credentials.password_enc',
    table: 'relay_credentials',
    column: 'password_enc',
    idColumn: 'id',
    aad: (id) => relayCredentialAad(id)
  },
  {
    label: 'station_sources.client_password_enc',
    table: 'station_sources',
    column: 'client_password_enc',
    idColumn: 'station_id',
    aad: (id) => `station_sources:client_password_enc:${id}`
  }
];

/** Secret v1 (hoặc chưa đúng chuẩn v2) cần rotate. */
export function needsRotation(payload: string): boolean {
  return !payload.startsWith('v2:');
}

/**
 * Đọc secret cũ (v1 bằng key hiện tại hoặc key trước) rồi mã hoá lại thành v2
 * gắn AAD. Chỉ dùng sau khi read-path đã hỗ trợ v2.
 */
export function decryptAny(payload: string): string {
  try {
    return decryptSecret(payload);
  } catch (error) {
    const previous = process.env.APP_ENC_KEY_PREVIOUS ?? '';
    if (!previous) throw error;
    return decryptSecret(payload, previous);
  }
}

export function rotateSecret(payload: string, aad: string): string {
  return encryptSecret(decryptAny(payload), undefined, aad);
}

interface RotationRow {
  recordId: number;
  payload: string;
}

async function loadRows(target: RotationTarget): Promise<RotationRow[]> {
  const rows = await query<any[]>(
    `SELECT ${target.idColumn} AS record_id, ${target.column} AS payload
       FROM ${target.table}
      WHERE ${target.column} IS NOT NULL AND ${target.column} <> ''
      ORDER BY ${target.idColumn}`
  );
  return rows.map((row) => ({ recordId: Number(row.record_id), payload: String(row.payload) }));
}

async function applyRows(target: RotationTarget, rows: RotationRow[]): Promise<void> {
  for (const row of rows) {
    const plain = decryptAny(row.payload);
    const payload = encryptSecret(plain, undefined, target.aad(row.recordId));
    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE ${target.table} SET ${target.column} = ? WHERE ${target.idColumn} = ?`,
        [payload, row.recordId]
      );
      // Đọc lại và giải mã để chắc chắn dữ liệu ghi đúng AAD.
      const [check] = await conn.query(
        `SELECT ${target.column} AS payload FROM ${target.table} WHERE ${target.idColumn} = ?`,
        [row.recordId]
      );
      const saved = String((check as any[])[0].payload);
      if (!saved.startsWith('v2:') || decryptSecret(saved, undefined, target.aad(row.recordId)) !== plain) {
        throw new Error(`${target.label} id=${row.recordId}: verify thất bại`);
      }
    });
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`[rotate-secrets] chế độ: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  if (!config.security.appEncKey) throw new Error('APP_ENC_KEY chưa cấu hình');

  let planned = 0;
  let failed = 0;
  for (const target of ROTATION_TARGETS) {
    const rows = await loadRows(target);
    const pending = rows.filter((row) => needsRotation(row.payload));
    planned += pending.length;
    console.log(
      `[rotate-secrets] ${target.label}: ${rows.length} secret, ${pending.length} cần rotate` +
        (pending.length > 0 ? ` (id: ${pending.map((row) => row.recordId).join(',')})` : '')
    );
    if (!apply || pending.length === 0) continue;
    try {
      await applyRows(target, pending);
      console.log(`[rotate-secrets] ${target.label}: đã rotate ${pending.length} secret`);
    } catch (error) {
      failed += 1;
      console.error(`[rotate-secrets] ${target.label}: lỗi ${(error as Error).message}`);
    }
  }

  if (!apply) {
    console.log('[rotate-secrets] dry-run xong; thêm --apply sau khi đã backup DB');
  } else if (failed > 0) {
    throw new Error(`${failed} bảng rotate lỗi`);
  } else {
    console.log(`[rotate-secrets] hoàn tất, ${planned} secret đã xử lý`);
  }
}

if (require.main === module) {
  main()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error(`[rotate-secrets] ${error.message}`);
      await closePool();
      process.exit(1);
    });
}
