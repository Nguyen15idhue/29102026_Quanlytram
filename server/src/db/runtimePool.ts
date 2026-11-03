import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';

export const runtimePool: Pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.appUser,
  password: config.mysql.appPassword,
  database: config.mysql.runtimeDatabase,
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 10_000,
  maxIdle: 5,
  idleTimeout: 60_000,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: true,
  ...(config.mysql.ssl ? { ssl: { rejectUnauthorized: true } } : {})
});

export async function runtimeQuery<T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const [rows] = await runtimePool.query<any>(sql, params);
  return rows as T;
}

export async function closeRuntimePool(): Promise<void> {
  await runtimePool.end();
}
