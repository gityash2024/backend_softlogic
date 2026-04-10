import path from 'path';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';

type ImportConversionType = 'pdf' | 'ppt';

interface ConvertDocumentInput {
  requestedType: ImportConversionType;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface ConvertedImportPageAsset {
  name: string;
  width: number;
  height: number;
  imageBase64: string;
}

export interface ConvertedImportPayload {
  format: 'PDF' | 'PPTX';
  sourceName: string;
  pages: ConvertedImportPageAsset[];
}

class ImportConversionService {
  async convertDocument(
    input: ConvertDocumentInput,
  ): Promise<ConvertedImportPayload> {
    this.ensureSupportedInput(input);

    if (!env.IMPORT_CONVERSION_WORKER_URL) {
      throw new AppError(
        'Document import conversion is not configured yet.',
        503,
      );
    }

    const form = new FormData();
    form.append('type', input.requestedType);
    form.append('sourceName', input.fileName);
    form.append(
      'document',
      new Blob([input.fileBuffer], { type: input.mimeType }),
      input.fileName,
    );

    const response = await fetch(env.IMPORT_CONVERSION_WORKER_URL, {
      method: 'POST',
      headers: env.IMPORT_CONVERSION_WORKER_TOKEN
        ? {
            Authorization: `Bearer ${env.IMPORT_CONVERSION_WORKER_TOKEN}`,
          }
        : undefined,
      body: form,
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          message?: string;
          data?: unknown;
        }
      | null;

    if (!response.ok) {
      throw new AppError(
        payload?.message ?? 'Unable to convert import document.',
        response.status || 502,
      );
    }

    const data = this.normalizeWorkerPayload(payload?.data, input);
    return data;
  }

  private ensureSupportedInput(input: ConvertDocumentInput): void {
    const extension = path.extname(input.fileName).toLowerCase();

    if (input.requestedType === 'pdf') {
      if (extension !== '.pdf') {
        throw new AppError('Only PDF files can be imported as PDF.', 400);
      }
      return;
    }

    if (extension === '.ppt') {
      throw new AppError(
        'Legacy .ppt files are not supported yet. Please use a .pptx file.',
        400,
      );
    }

    if (extension !== '.pptx') {
      throw new AppError('Only .pptx files can be imported as PPT.', 400);
    }
  }

  private normalizeWorkerPayload(
    payload: unknown,
    input: ConvertDocumentInput,
  ): ConvertedImportPayload {
    if (!payload || typeof payload !== 'object') {
      throw new AppError('Import conversion worker returned an invalid payload.', 502);
    }

    const record = payload as Record<string, unknown>;
    const rawPages = Array.isArray(record.pages) ? record.pages : null;
    if (!rawPages || rawPages.length == 0) {
      throw new AppError('Import conversion worker did not return any pages.', 502);
    }

    const pages = rawPages.map((page, index) => {
      if (!page || typeof page !== 'object') {
        throw new AppError('Import conversion worker returned an invalid page.', 502);
      }
      const pageRecord = page as Record<string, unknown>;
      const imageBase64 = `${pageRecord.imageBase64 ?? ''}`.trim();
      if (imageBase64.length === 0) {
        throw new AppError('Import conversion worker returned an empty slide image.', 502);
      }
      const name = `${pageRecord.name ?? ''}`.trim();

      return {
        name: name.length > 0 ? name : `Page ${index + 1}`,
        width: this.toPositiveNumber(pageRecord.width, 1280),
        height: this.toPositiveNumber(pageRecord.height, 720),
        imageBase64,
      };
    });

    return {
      format: input.requestedType === 'pdf' ? 'PDF' : 'PPTX',
      sourceName: `${record.sourceName ?? input.fileName}`,
      pages,
    };
  }

  private toPositiveNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && value > 0) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (parsed > 0) {
        return parsed;
      }
    }
    return fallback;
  }
}

export const importConversionService = new ImportConversionService();
