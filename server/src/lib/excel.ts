import ExcelJS from 'exceljs';
import { ApiError } from './http';

export type ExcelRow = Record<string, string>;

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export async function readWorkbook(dataBase64: string): Promise<ExcelJS.Workbook> {
  if (!dataBase64) throw new ApiError(400, 'VALIDATION_ERROR', 'Thiếu file Excel');
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'File Excel rỗng');
  if (buffer.length > 10 * 1024 * 1024) {
    throw new ApiError(413, 'FILE_TOO_LARGE', 'File Excel vượt quá 10MB');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook;
}

export function readSheetRows(workbook: ExcelJS.Workbook): ExcelRow[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ApiError(400, 'VALIDATION_ERROR', 'File Excel không có sheet');
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col] = normalizeHeader(cell.value);
  });
  if (headers.filter(Boolean).length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Thiếu dòng tiêu đề');
  }

  const rows: ExcelRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: ExcelRow = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const value = cell.value;
      item[key] =
        value === null || value === undefined
          ? ''
          : typeof value === 'object' && 'text' in value
            ? String((value as { text: string }).text)
            : String(value);
    });
    if (Object.values(item).some((value) => value !== '')) rows.push(item);
  });
  return rows;
}

export async function buildWorkbook(
  headers: string[],
  rows: Array<Array<string | number | null>>,
  sheetName = 'Sheet1'
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of rows) sheet.addRow(row);
  sheet.columns.forEach((column) => {
    column.width = Math.max(14, Math.min(32, (column.header?.length ?? 12) + 4));
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function sendWorkbook(res: any, buffer: Buffer, filename: string): void {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
