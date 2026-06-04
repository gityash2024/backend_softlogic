import path from 'path';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { PNG } from 'pngjs';
import { isExpectedImportRawAsset } from '@/shared/services/cloudinary.service';
import {
  createSignedImportObjectReadUrl,
  getImportObjectMetadata,
  getImportObjectPrefix,
  isExpectedImportObjectKey,
  MAX_DOCUMENT_IMPORT_BYTES,
} from '@/shared/services/import-temp-storage.service';

type ImportConversionType = 'pdf' | 'ppt' | 'pptx';
type ImportErrorCode =
  | 'IMPORT_FILE_TOO_LARGE'
  | 'IMPORT_EMPTY_FILE'
  | 'IMPORT_UNSUPPORTED_TYPE'
  | 'IMPORT_CORRUPT_DOCUMENT'
  | 'IMPORT_PASSWORD_PROTECTED'
  | 'IMPORT_NETWORK_FAILURE'
  | 'IMPORT_CONVERSION_TIMEOUT'
  | 'IMPORT_CONVERSION_FAILED';

const CONVERSION_TIMEOUT_MS = 240_000;

const importError = (
  message: string,
  statusCode: number,
  code: ImportErrorCode,
): AppError => new AppError(message, statusCode, true, code);

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
    this.ensureDocumentBytes(input);

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
      const metadata = await getImportObjectMetadata(storageKey);
      if (metadata.sizeBytes <= 0) {
        throw importError('The selected file is empty.', 400, 'IMPORT_EMPTY_FILE');
      }
      if (metadata.sizeBytes > MAX_DOCUMENT_IMPORT_BYTES) {
        throw importError(
          'File size should not be more than 50 MB.',
          413,
          'IMPORT_FILE_TOO_LARGE',
        );
      }
      this.ensureDocumentMimeType(input.fileName, metadata.contentType);
      this.ensureDocumentSignature(
        input.fileName,
        await getImportObjectPrefix(storageKey),
      );
    } else if (
      !fileUrl ||
      !isExpectedImportRawAsset({
        fileUrl,
        publicId: input.publicId,
      })
    ) {
      throw new AppError('Remote import file URL is not trusted.', 400);
    }

    return this.convertDocumentUrlWithConvertApi({
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

    const response = await this.fetchConversion(workerUrl, {
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
      throw this.providerError(
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

    const response = await this.fetchConversion(endpoint, {
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
      throw this.providerError(
        payload?.Message ?? payload?.message ?? 'Unable to convert PowerPoint import document.',
        response.status || 502,
      );
    }

    return this.normalizeConvertApiPayload(payload, input);
  }

  private async convertDocumentUrlWithConvertApi(input: {
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

    const response = await this.fetchConversion(endpoint, {
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
      throw this.providerError(
        payload?.Message ?? payload?.message ?? 'Unable to convert import document.',
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
        throw importError(
          'Only PDF files can be imported as PDF.',
          400,
          'IMPORT_UNSUPPORTED_TYPE',
        );
      }
      return;
    }

    if (extension !== '.ppt' && extension !== '.pptx') {
      throw importError(
        'Only PowerPoint files can be imported as PPT.',
        400,
        'IMPORT_UNSUPPORTED_TYPE',
      );
    }
  }

  private ensureDocumentBytes(input: ConvertDocumentInput): void {
    if (input.fileBuffer.length === 0) {
      throw importError('The selected file is empty.', 400, 'IMPORT_EMPTY_FILE');
    }
    if (input.fileBuffer.length > MAX_DOCUMENT_IMPORT_BYTES) {
      throw importError(
        'File size should not be more than 50 MB.',
        413,
        'IMPORT_FILE_TOO_LARGE',
      );
    }
    this.ensureDocumentMimeType(input.fileName, input.mimeType);
    this.ensureDocumentSignature(input.fileName, input.fileBuffer);
  }

  private ensureDocumentMimeType(fileName: string, mimeType: string): void {
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized || normalized === 'application/octet-stream') {
      return;
    }
    const extension = path.extname(fileName).toLowerCase();
    const isExpected =
      (extension === '.pdf' && normalized === 'application/pdf') ||
      (extension === '.ppt' &&
        normalized === 'application/vnd.ms-powerpoint') ||
      (extension === '.pptx' &&
        normalized ===
          'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    if (!isExpected) {
      throw importError(
        'The document MIME type does not match its file type.',
        400,
        'IMPORT_UNSUPPORTED_TYPE',
      );
    }
  }

  private ensureDocumentSignature(fileName: string, bytes: Buffer): void {
    const extension = path.extname(fileName).toLowerCase();
    const isPdf = extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    const isPptx =
      extension === '.pptx' && bytes[0] === 0x50 && bytes[1] === 0x4b;
    const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const isPpt = extension === '.ppt' && bytes.subarray(0, 8).equals(oleHeader);
    if (!isPdf && !isPptx && !isPpt) {
      throw importError(
        'The document is corrupted or does not match its file type.',
        400,
        'IMPORT_CORRUPT_DOCUMENT',
      );
    }
  }

  private async fetchConversion(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONVERSION_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw importError(
          'Document conversion timed out. Please try again.',
          504,
          'IMPORT_CONVERSION_TIMEOUT',
        );
      }
      throw importError(
        'Unable to reach the document conversion service.',
        502,
        'IMPORT_NETWORK_FAILURE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private providerError(message: string, statusCode: number): AppError {
    const normalized = message.toLowerCase();
    if (normalized.includes('password') || normalized.includes('encrypted')) {
      return importError(
        'Password-protected documents are not supported.',
        400,
        'IMPORT_PASSWORD_PROTECTED',
      );
    }
    if (
      normalized.includes('corrupt') ||
      normalized.includes('invalid') ||
      normalized.includes('damaged')
    ) {
      return importError(
        'The document is corrupted or invalid.',
        400,
        'IMPORT_CORRUPT_DOCUMENT',
      );
    }
    return importError(message, statusCode, 'IMPORT_CONVERSION_FAILED');
  }

  private normalizeWorkerPayload(
    payload: unknown,
    input: ConvertDocumentInput,
  ): ConvertedImportPayload {
    if (!payload || typeof payload !== 'object') {
      throw importError(
        'Import conversion worker returned an invalid payload.',
        502,
        'IMPORT_CONVERSION_FAILED',
      );
    }

    const record = payload as Record<string, unknown>;
    const rawPages = Array.isArray(record.pages) ? record.pages : null;
    if (!rawPages || rawPages.length == 0) {
      throw importError(
        'Import conversion worker did not return any pages.',
        502,
        'IMPORT_CONVERSION_FAILED',
      );
    }

    const pages = rawPages.map((page, index) => {
      if (!page || typeof page !== 'object') {
        throw importError(
          'Import conversion worker returned an invalid page.',
          502,
          'IMPORT_CONVERSION_FAILED',
        );
      }
      const pageRecord = page as Record<string, unknown>;
      const imageBase64 = `${pageRecord.imageBase64 ?? ''}`.trim();
      if (imageBase64.length === 0) {
        throw importError(
          'Import conversion worker returned an empty slide image.',
          502,
          'IMPORT_CONVERSION_FAILED',
        );
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
      throw importError(
        'ConvertAPI returned an invalid payload.',
        502,
        'IMPORT_CONVERSION_FAILED',
      );
    }

    const record = payload as Record<string, unknown>;
    const rawFiles = Array.isArray(record.Files) ? record.Files : null;
    if (!rawFiles || rawFiles.length === 0) {
      throw importError(
        'ConvertAPI did not return any pages.',
        502,
        'IMPORT_CONVERSION_FAILED',
      );
    }

    const pages = rawFiles.map((file, index) => {
      if (!file || typeof file !== 'object') {
        throw importError(
          'ConvertAPI returned an invalid page.',
          502,
          'IMPORT_CONVERSION_FAILED',
        );
      }
      const fileRecord = file as Record<string, unknown>;
      const imageBase64 = `${fileRecord.FileData ?? ''}`.trim();
      const imageUrl = `${fileRecord.Url ?? fileRecord.FileUrl ?? ''}`.trim();
      if (imageBase64.length === 0 && imageUrl.length === 0) {
        throw importError(
          'ConvertAPI returned an empty page image.',
          502,
          'IMPORT_CONVERSION_FAILED',
        );
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
