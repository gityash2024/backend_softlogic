import { exportService } from '@/modules/export/export.service';

describe('ExportService', () => {
  it('returns higher raster width for ultra resolution exports', () => {
    const standardWidth = (exportService as any).resolveCanvasWidth('STANDARD');
    const ultraWidth = (exportService as any).resolveCanvasWidth('ULTRA');

    expect(standardWidth).toBeLessThan(ultraWidth);
  });

  it('returns descending jpeg quality across export presets', () => {
    const low = (exportService as any).resolveJpegQuality('LOW');
    const medium = (exportService as any).resolveJpegQuality('MEDIUM');
    const high = (exportService as any).resolveJpegQuality('HIGH');

    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });
});
