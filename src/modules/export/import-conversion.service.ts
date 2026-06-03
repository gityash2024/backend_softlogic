import path from 'path';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { PNG } from 'pngjs';
import { isExpectedImportRawAsset } from '@/shared/services/cloudinary.service';
import {
  createSignedImportObjectReadUrl,
  isExpectedImportObjectKey,
} from '@/shared/services/import-temp-storage.service';

type ImportConversionType = 'pdf' | 'ppt' | 'pptx';

interface ConvertDocumentInput {
  requestedType: ImportConversionType;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  metadata?: Record<string, string>;
}

export interface ConvertedImportPageAsset {
  name: string;
  width: number;
  height: number;
  imageBase64?: string;
  imageUrl?: string;
}

export interface ConvertedImportPayload {
  format: 'PDF' | 'PPT' | 'PPTX';
  sourceName: string;
  pages: ConvertedImportPageAsset[];
}

class ImportConversionService {
  async convertDocument(
    input: ConvertDocumentInput,
  ): Promise<ConvertedImportPayload> {
    this.ensureSupportedInput(input);

    if (env.IMPORT_CONVERSION_WORKER_URL) {
      return this.convertWithWorker(input);
    }

    if (env.CONVERTAPI_TOKEN && this.toWorkerType(input.requestedType) === 'ppt') {
      return this.convertPowerPointWithConvertApi(input);
    }

    throw new AppError(
      'Document import conversion is not configured yet.',
      503,
    );
  }

  async convertRemoteDocument(input: {
    requestedType: ImportConversionType;
    fileName: string;
    fileUrl?: string | null;
    publicId?: string | null;
    storageKey?: string | null;
    userId?: string | null;
  }): Promise<ConvertedImportPayload> {
    this.ensureSupportedInput({
      requestedType: input.requestedType,
      fileBuffer: Buffer.alloc(0),
      fileName: input.fileName,
      mimeType: '',
    });

    if (this.toWorkerType(input.requestedType) !== 'ppt') {
      throw new AppError('Only PowerPoint files can be imported from remote URLs.', 400);
    }
    if (!env.CONVERTAPI_TOKEN) {
      throw new AppError('Document import conversion is not configured yet.', 503);
    }

    let fileUrl = input.fileUrl?.trim() ?? '';
    const storageKey = input.storageKey?.trim() ?? '';
    if (storageKey) {
      if (
        !input.userId ||
        !isExpectedImportObjectKey({
          storageKey,
          userId: input.userId,
        })
      ) {
        throw new AppError('Remote import storage key is not trusted.', 400);
      }
      fileUrl = await createSignedImportObjectReadUrl(storageKey);
    } else if (
      !fileUrl ||
      !isExpectedImportRawAsset({
        fileUrl,
        publicId: input.publicId,
      })
    ) {
      throw new AppError('Remote import file URL is not trusted.', 400);
    }

    return this.convertPowerPointUrlWithConvertApi({
      requestedType: input.requestedType,
      fileName: input.fileName,
      fileUrl,
    });
  }

  private async convertWithWorker(
    input: ConvertDocumentInput,
  ): Promise<ConvertedImportPayload> {
    const workerUrl = env.IMPORT_CONVERSION_WORKER_URL;
    if (!workerUrl) {
      throw new AppError(
        'Document import conversion is not configured yet.',
        503,
      );
    }

    const form = new FormData();
    form.append('type', this.toWorkerType(input.requestedType));
    form.append('sourceName', input.fileName);
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      form.append(key, value);
    }
    form.append(
      'document',
      new Blob([input.fileBuffer], { type: input.mimeType }),
      input.fileName,
    );

    const response = await fetch(workerUrl, {
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

  private async convertPowerPointWithConvertApi(
    input: ConvertDocumentInput,
  ): Promise<ConvertedImportPayload> {
    const extension = path.extname(input.fileName).toLowerCase().replace('.', '');
    const endpoint = `${env.CONVERTAPI_BASE_URL.replace(/\/+$/, '')}/convert/${extension}/to/png`;
    const form = new FormData();
    form.append(
      'File',
      new Blob([input.fileBuffer], { type: input.mimeType }),
      input.fileName,
    );
    form.append('StoreFile', 'false');
    form.append('PageRange', '1-2000');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CONVERTAPI_TOKEN}`,
      },
      body: form,
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          Message?: string;
          message?: string;
          Files?: Array<{
            FileName?: string;
            FileData?: string;
            Url?: string;
          }>;
        }
      | null;

    if (!response.ok) {
      throw new AppError(
        payload?.Message ?? payload?.message ?? 'Unable to convert PowerPoint import document.',
        response.status || 502,
      );
    }

    return this.normalizeConvertApiPayload(payload, input);
  }

  private async convertPowerPointUrlWithConvertApi(input: {
    requestedType: ImportConversionType;
    fileName: string;
    fileUrl: string;
  }): Promise<ConvertedImportPayload> {
    const extension = path.extname(input.fileName).toLowerCase().replace('.', '');
    const endpoint = `${env.CONVERTAPI_BASE_URL.replace(/\/+$/, '')}/convert/${extension}/to/png`;
    const body = {
      Parameters: [
        {
          Name: 'File',
          FileValue: {
            Name: input.fileName,
            Url: input.fileUrl,
          },
        },
        { Name: 'StoreFile', Value: true },
        { Name: 'PageRange', Value: '1-2000' },
      ],
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CONVERTAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          Message?: string;
          message?: string;
          Files?: Array<{
            FileName?: string;
            FileData?: string;
            Url?: string;
            FileUrl?: string;
          }>;
        }
      | null;

    if (!response.ok) {
      throw new AppError(
        payload?.Message ?? payload?.message ?? 'Unable to convert PowerPoint import document.',
        response.status || 502,
      );
    }

    return this.normalizeConvertApiPayload(payload, {
      requestedType: input.requestedType,
      fileBuffer: Buffer.alloc(0),
      fileName: input.fileName,
      mimeType: '',
    });
  }

  private ensureSupportedInput(input: ConvertDocumentInput): void {
    const extension = path.extname(input.fileName).toLowerCase();

    if (this.toWorkerType(input.requestedType) === 'pdf') {
      if (extension !== '.pdf') {
        throw new AppError('Only PDF files can be imported as PDF.', 400);
      }
      return;
    }

    if (extension !== '.ppt' && extension !== '.pptx') {
      throw new AppError('Only PowerPoint files can be imported as PPT.', 400);
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
      format: this.resolveFormat(input),
      sourceName: `${record.sourceName ?? input.fileName}`,
      pages,
    };
  }

  private normalizeConvertApiPayload(
    payload: unknown,
    input: ConvertDocumentInput,
  ): ConvertedImportPayload {
    if (!payload || typeof payload !== 'object') {
      throw new AppError('ConvertAPI returned an invalid payload.', 502);
    }

    const record = payload as Record<string, unknown>;
    const rawFiles = Array.isArray(record.Files) ? record.Files : null;
    if (!rawFiles || rawFiles.length === 0) {
      throw new AppError('ConvertAPI did not return any slides.', 502);
    }

    const pages = rawFiles.map((file, index) => {
      if (!file || typeof file !== 'object') {
        throw new AppError('ConvertAPI returned an invalid slide.', 502);
      }
      const fileRecord = file as Record<string, unknown>;
      const imageBase64 = `${fileRecord.FileData ?? ''}`.trim();
      const imageUrl = `${fileRecord.Url ?? fileRecord.FileUrl ?? ''}`.trim();
      if (imageBase64.length === 0 && imageUrl.length === 0) {
        throw new AppError('ConvertAPI returned an empty slide image.', 502);
      }
      const dimensions = imageBase64.length > 0
        ? this.readPngDimensions(imageBase64)
        : { width: 1280, height: 720 };
      const fileName = `${fileRecord.FileName ?? ''}`.trim();

      return {
        name: fileName.length > 0 ? fileName : `Slide ${index + 1}`,
        width: dimensions.width,
        height: dimensions.height,
        ...(imageBase64.length > 0 ? { imageBase64 } : {}),
        ...(imageUrl.length > 0 ? { imageUrl } : {}),
      };
    });

    return {
      format: this.resolveFormat(input),
      sourceName: input.fileName,
      pages,
    };
  }

  private resolveFormat(input: ConvertDocumentInput): 'PDF' | 'PPT' | 'PPTX' {
    if (this.toWorkerType(input.requestedType) === 'pdf') {
      return 'PDF';
    }
    return path.extname(input.fileName).toLowerCase() === '.ppt' ? 'PPT' : 'PPTX';
  }

  private toWorkerType(type: ImportConversionType): 'pdf' | 'ppt' {
    return type === 'pdf' ? 'pdf' : 'ppt';
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

  private readPngDimensions(imageBase64: string): { width: number; height: number } {
    try {
      const png = PNG.sync.read(Buffer.from(imageBase64, 'base64')) as {
        width?: number;
        height?: number;
      };
      return {
        width: this.toPositiveNumber(png.width, 1280),
        height: this.toPositiveNumber(png.height, 720),
      };
    } catch {
      return { width: 1280, height: 720 };
    }
  }
}

export const importConversionService = new ImportConversionService();
