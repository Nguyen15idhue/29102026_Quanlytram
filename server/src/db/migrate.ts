import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../config';

type Scope = 'admin' | 'runtime';

const base = {
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.migratorUser,
  password: config.mysql.migratorPassword,
  multipleStatements: true
};

async function applyScope(
  scope: Scope,
  connection: mysql.Connection,
  adminConnection: mysql.Connection,
  directory: string
): Promise<number> {
  await adminConnection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       scope ENUM('admin','runtime') NOT NULL,
       version INT NOT NULL,
       applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (scope, version)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
  );

  const files = (await fs.readdir(directory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let applied = 0;
  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0], 10);
    if (!Number.isFinite(version)) {
      throw new Error(`Invalid migration filename: ${file}`);
    }

    const [existing] = await adminConnection.query<mysql.RowDataPacket[]>(
      'SELECT 1 FROM schema_migrations WHERE scope = ? AND version = ?',
      [scope, version]
    );
    if (existing.length > 0) continue;

    const sql = await fs.readFile(path.join(directory, file), 'utf8');
    if (sql.trim()) await connection.query(sql);
    await adminConnection.query(
      'INSERT INTO schema_migrations (scope, version) VALUES (?, ?)',
      [scope, version]
    );
    applied += 1;
    console.log(`[migrate] ${scope} ${file} applied`);
  }
  return applied;
}

async function main(): Promise<void> {
  const admin = await mysql.createConnection({
    ...base,
    database: config.mysql.adminDatabase
  });
  const runtime = await mysql.createConnection({
    ...base,
    database: config.mysql.runtimeDatabase
  });

  try {
    const root = config.migrationsDir;
    const adminApplied = await applyScope(
      'admin',
      admin,
      admin,
      path.join(root, 'admin')
    );
    const runtimeApplied = await applyScope(
      'runtime',
      runtime,
      admin,
      path.join(root, 'runtime')
    );
    console.log(
      `[migrate] done admin=${adminApplied} runtime=${runtimeApplied}`
    );
  } finally {
    await admin.end();
    await runtime.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
