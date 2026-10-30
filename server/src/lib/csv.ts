export const UTF8_BOM = '\uFEFF';

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

export function csvBuffer(headers: string[], rows: unknown[][]): Buffer {
  return Buffer.from(toCsv(headers, rows), 'utf8');
}
