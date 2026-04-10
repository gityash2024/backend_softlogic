import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { importConversionService } from '@/modules/export/import-conversion.service';

describe('ImportConversionService', () => {
  const originalWorkerUrl = env.IMPORT_CONVERSION_WORKER_URL;
  const originalWorkerToken = env.IMPORT_CONVERSION_WORKER_TOKEN;

  beforeEach(() => {
    env.IMPORT_CONVERSION_WORKER_URL = 'https://worker.example/convert';
    env.IMPORT_CONVERSION_WORKER_TOKEN = 'test-token';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    env.IMPORT_CONVERSION_WORKER_URL = originalWorkerUrl;
    env.IMPORT_CONVERSION_WORKER_TOKEN = originalWorkerToken;
    jest.resetAllMocks();
  });

  it('returns ordered converted PDF page assets from the worker', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          sourceName: 'demo.pdf',
          pages: [
            {
              name: 'Page 1',
              width: 1280,
              height: 720,
              imageBase64: 'ZmFrZQ==',
            },
            {
              name: 'Page 2',
              width: 1280,
              height: 720,
              imageBase64: 'ZmFrZTI=',
            },
          ],
        },
      }),
    });

    const result = await importConversionService.convertDocument({
      requestedType: 'pdf',
      fileBuffer: Buffer.from('pdf'),
      fileName: 'demo.pdf',
      mimeType: 'application/pdf',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.format).toBe('PDF');
    expect(result.sourceName).toBe('demo.pdf');
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.name).toBe('Page 1');
  });

  it('rejects legacy ppt files with a clear validation error', async () => {
    let thrown: unknown;
    try {
      await importConversionService.convertDocument({
        requestedType: 'ppt',
        fileBuffer: Buffer.from('ppt'),
        fileName: 'legacy.ppt',
        mimeType: 'application/vnd.ms-powerpoint',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(
      'Legacy .ppt files are not supported yet. Please use a .pptx file.',
    );
    expect((thrown as AppError).statusCode).toBe(400);
  });

  it('rejects empty worker payloads cleanly', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { sourceName: 'demo.pdf', pages: [] } }),
    });

    let thrown: unknown;
    try {
      await importConversionService.convertDocument({
        requestedType: 'pdf',
        fileBuffer: Buffer.from('pdf'),
        fileName: 'demo.pdf',
        mimeType: 'application/pdf',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(
      'Import conversion worker did not return any pages.',
    );
    expect((thrown as AppError).statusCode).toBe(502);
  });
});
