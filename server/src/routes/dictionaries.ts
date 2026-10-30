import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { asyncHandler } from '../lib/http';
import { requireAuth } from '../middleware/auth';

export const dictionariesRouter = Router();
dictionariesRouter.use(requireAuth);

dictionariesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const code = String(req.query.code || '').trim();
    const params: unknown[] = [];
    let where = 'enabled = 1';
    if (code) {
      where += ' AND dict_code = ?';
      params.push(code);
    }
    const rows = await query<RowDataPacket[]>(
      `SELECT id, dict_code, dict_key, dict_value, locale, sort_order
         FROM dictionaries
        WHERE ${where}
        ORDER BY dict_code, sort_order, dict_value`,
      params
    );
    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        code: String(row.dict_code),
        key: String(row.dict_key),
        value: String(row.dict_value),
        locale: String(row.locale),
        sortOrder: Number(row.sort_order)
      }))
    });
  })
);
