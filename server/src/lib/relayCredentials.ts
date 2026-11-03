import { encryptSecret, secretAad } from './crypto';
import { ApiError } from './http';

export interface CredentialInput {
  username: string;
  password?: string;
}

/** AAD của secret trong bảng relay_credentials (khớp phía Go). */
export function relayCredentialAad(credentialId: number): string {
  return secretAad('relay_credentials', 'password_enc', credentialId);
}

/** Mã hoá mật khẩu relay gắn AAD theo id credential. */
export function encryptRelayPassword(plain: string, credentialId: number): string {
  return encryptSecret(plain, undefined, relayCredentialAad(credentialId));
}

/**
 * Tạo/cập nhật credential relay và mã hoá mật khẩu bằng AAD `id` bản ghi.
 *
 * Id chỉ có sau INSERT nên nhánh tạo mới ghi trước một dòng với
 * `password_enc=''` rồi UPDATE lại trong cùng transaction: bên đọc không thấy
 * trạng thái trung gian, và secret v2 luôn khớp AAD.
 */
export async function upsertRelayCredential(
  conn: any,
  input: CredentialInput | null | undefined,
  existingId: number | null,
  name: string,
  ownerId: number,
  actorId: number,
  companyId: number | null = null
): Promise<number | null> {
  if (input === undefined) return existingId;
  if (input === null) return null;

  if (existingId) {
    const [rows] = await conn.query('SELECT id FROM relay_credentials WHERE id = ?', [existingId]);
    if (rows.length > 0) {
      if (input.password) {
        await conn.query(
          'UPDATE relay_credentials SET name = ?, username = ?, password_enc = ? WHERE id = ?',
          [name, input.username, encryptRelayPassword(input.password, existingId), existingId]
        );
      } else {
        await conn.query('UPDATE relay_credentials SET name = ?, username = ? WHERE id = ?', [
          name,
          input.username,
          existingId
        ]);
      }
      return existingId;
    }
  }

  if (!input.password) {
    throw new ApiError(400, 'CREDENTIAL_PASSWORD_REQUIRED', 'Cần mật khẩu cho credential mới');
  }
  const [result]: any = await conn.query(
    `INSERT INTO relay_credentials (name, username, password_enc, owner_web_user_id, company_id, created_by)
     VALUES (?, ?, '', ?, ?, ?)`,
    [name, input.username, ownerId, companyId, actorId]
  );
  const credentialId = Number(result.insertId);
  await conn.query('UPDATE relay_credentials SET password_enc = ? WHERE id = ?', [
    encryptRelayPassword(input.password, credentialId),
    credentialId
  ]);
  return credentialId;
}
