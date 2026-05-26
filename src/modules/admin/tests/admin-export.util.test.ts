import { buildAdminExport, type AdminExportColumn } from '../admin-export.util';

describe('admin export utility', () => {
  type Row = {
    name: string;
    status: string;
    createdAt: Date;
  };
  const columns: AdminExportColumn<Row>[] = [
    { header: 'Name', key: 'name', value: (row) => row.name },
    { header: 'Status', key: 'status', value: (row) => row.status },
    {
      header: 'Created',
      key: 'createdAt',
      value: (row) => row.createdAt,
    },
  ];
  const rows = [
    {
      name: 'SoftLogic, Internal',
      status: 'ACTIVE',
      createdAt: new Date('2026-05-25T00:00:00.000Z'),
    },
  ];

  it('creates escaped CSV exports with metadata comments', async () => {
    const file = await buildAdminExport({
      title: 'Organizations',
      fileBaseName: 'softlogic-organizations',
      format: 'csv',
      rows,
      columns,
      filters: { status: 'ACTIVE' },
    });

    const csv = file.buffer.toString('utf8');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.fileName).toMatch(/softlogic-organizations-.*\.csv/);
    expect(csv).toContain('"SoftLogic, Internal",ACTIVE');
  });

  it('creates XLSX workbooks for filtered data', async () => {
    const file = await buildAdminExport({
      title: 'Organizations',
      fileBaseName: 'softlogic-organizations',
      format: 'xlsx',
      rows,
      columns,
      filters: { status: 'ACTIVE' },
    });

    expect(file.contentType).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(file.fileName).toMatch(/softlogic-organizations-.*\.xlsx/);
    expect(file.buffer.length).toBeGreaterThan(1000);
  });
});
