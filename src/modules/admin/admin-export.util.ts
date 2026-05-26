import ExcelJS from 'exceljs';

export type AdminExportFormat = 'xlsx' | 'csv';

export interface AdminExportColumn<T> {
  header: string;
  key: string;
  width?: number;
  value: (row: T) => unknown;
}

export interface AdminExportOptions<T> {
  title: string;
  fileBaseName: string;
  format: AdminExportFormat;
  rows: T[];
  columns: AdminExportColumn<T>[];
  filters?: Record<string, unknown>;
}

export interface AdminExportFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

const normalizeCell = (value: unknown): string | number | boolean | Date | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

const csvEscape = (value: unknown): string => {
  const normalized = normalizeCell(value);
  if (normalized === null) return '';
  const text =
    normalized instanceof Date ? normalized.toISOString() : String(normalized);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const timestamp = (): string =>
  new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

export async function buildAdminExport<T>(
  options: AdminExportOptions<T>,
): Promise<AdminExportFile> {
  if (options.format === 'csv') {
    const header = options.columns.map((column) => csvEscape(column.header));
    const body = options.rows.map((row) =>
      options.columns.map((column) => csvEscape(column.value(row))).join(','),
    );
    return {
      buffer: Buffer.from([header.join(','), ...body].join('\r\n'), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      fileName: `${options.fileBaseName}-${timestamp()}.csv`,
    };
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SoftLogic Admin';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(options.title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = options.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? Math.max(column.header.length + 4, 16),
  }));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: options.columns.length },
  };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1149B5' },
    };
    cell.alignment = { vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD7DFEA' } },
    };
  });

  options.rows.forEach((row) => {
    sheet.addRow(
      Object.fromEntries(
        options.columns.map((column) => [
          column.key,
          normalizeCell(column.value(row)),
        ]),
      ),
    );
  });
  sheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 22 : 20;
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5EAF2' } },
      };
    });
  });

  const metadata = workbook.addWorksheet('Export Metadata');
  metadata.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 70 },
  ];
  metadata.addRows([
    { field: 'Export', value: options.title },
    { field: 'Generated At', value: new Date().toISOString() },
    { field: 'Rows', value: options.rows.length },
    { field: 'Filters', value: JSON.stringify(options.filters ?? {}) },
  ]);
  metadata.getRow(1).font = { bold: true };

  const raw = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer),
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${options.fileBaseName}-${timestamp()}.xlsx`,
  };
}
