import fs from 'fs/promises';
import path from 'path';
import {
  Canvas,
  Export as ExportRecord,
  ExportFormat,
  ExportStatus,
  Organization,
  Prisma,
  Slide,
} from '@prisma/client';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';

type ExportCanvasSnapshot = Canvas & {
  organization: Organization | null;
  slides: Slide[];
};

interface ExportGenerationOptions {
  canvas: ExportCanvasSnapshot;
  exportId: string;
  format: 'PDF' | 'PNG' | 'JPG';
  requestedSlideIds?: string[];
}

interface GeneratedArtifact {
  filePath: string;
  fileSize: number;
}

interface SlideSummary {
  id: string;
  name: string;
  order: number;
  elementCount: number;
}

interface RasterDocument {
  width: number;
  height: number;
  pngBytes: Buffer;
  jpegBytes: Buffer;
}

type RgbaColor = [number, number, number, number];
type RasterCanvas = any;

const FONT_3X5: Record<string, string[]> = {
  ' ': ['000', '000', '000', '000', '000'],
  '-': ['000', '000', '111', '000', '000'],
  ':': ['000', '010', '000', '010', '000'],
  '.': ['000', '000', '000', '000', '010'],
  '/': ['001', '001', '010', '100', '100'],
  '?': ['111', '001', '010', '000', '010'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '111', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
};

export class ExportService {
  private readonly outputRoot = path.resolve(process.cwd(), 'storage', 'exports');

  async generateExport(options: ExportGenerationOptions): Promise<ExportRecord> {
    await prisma.export.update({
      where: { id: options.exportId },
      data: {
        status: ExportStatus.PROCESSING,
        error: null,
        completedAt: null,
      },
    });

    try {
      const slides = this.resolveSlides(
        options.canvas.slides,
        options.requestedSlideIds,
      );
      if (slides.length === 0) {
        throw new AppError('At least one slide is required for export', 400);
      }

      const raster = this.buildRasterDocument(options.canvas, slides);
      const artifact =
        options.format === 'PDF'
          ? await this.writePdfArtifact(options.exportId, options.canvas, raster)
          : await this.writeImageArtifact(
              options.exportId,
              options.canvas,
              raster,
              options.format,
            );

      return prisma.export.update({
        where: { id: options.exportId },
        data: {
          status: ExportStatus.COMPLETED,
          fileUrl: artifact.filePath,
          fileSize: artifact.fileSize,
          completedAt: new Date(),
          error: null,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to generate export';
      await prisma.export.update({
        where: { id: options.exportId },
        data: {
          status: ExportStatus.FAILED,
          error: message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  getDownloadName(exportRecord: Pick<ExportRecord, 'id' | 'format' | 'fileUrl'>): string {
    const existingName = exportRecord.fileUrl
      ? path.basename(exportRecord.fileUrl)
      : null;
    if (existingName) {
      return existingName;
    }

    return `whiteboard-export-${exportRecord.id}.${this.extensionFor(exportRecord.format)}`;
  }

  getMimeType(format: ExportFormat): string {
    switch (format) {
      case ExportFormat.PDF:
        return 'application/pdf';
      case ExportFormat.JPG:
        return 'image/jpeg';
      case ExportFormat.PNG:
      default:
        return 'image/png';
    }
  }

  private resolveSlides(slides: Slide[], requestedSlideIds?: string[]): Slide[] {
    const orderedSlides = [...slides].sort((left, right) => left.order - right.order);
    if (!requestedSlideIds || requestedSlideIds.length === 0) {
      return orderedSlides;
    }

    const slideMap = new Map(orderedSlides.map((slide) => [slide.id, slide]));
    return requestedSlideIds.map((slideId) => {
      const slide = slideMap.get(slideId);
      if (!slide) {
        throw new AppError(`Slide ${slideId} not found for export`, 400);
      }
      return slide;
    });
  }

  private buildRasterDocument(
    canvas: ExportCanvasSnapshot,
    slides: Slide[],
  ): RasterDocument {
    const summaries = slides.map((slide) => this.toSlideSummary(slide));
    const layout = this.resolveLayout(summaries.length);
    const png = new PNG({ width: layout.width, height: layout.height }) as RasterCanvas;

    this.fillRect(png, 0, 0, layout.width, layout.height, [248, 250, 252, 255]);
    this.fillRect(png, 0, 0, layout.width, 176, [17, 24, 39, 255]);
    this.fillRect(png, 0, 176, layout.width, 8, [56, 189, 248, 255]);

    this.drawText(
      png,
      48,
      42,
      this.sanitizeLabel(canvas.name || 'WHITEBOARD EXPORT'),
      [255, 255, 255, 255],
      6,
    );
    this.drawText(
      png,
      48,
      98,
      this.sanitizeLabel(
        `${summaries.length} SLIDES ${canvas.organization?.name ?? 'LOCAL WORKSPACE'}`,
      ),
      [191, 219, 254, 255],
      3,
    );
    this.drawText(
      png,
      48,
      132,
      this.sanitizeLabel(
        `GENERATED ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
      ),
      [148, 163, 184, 255],
      3,
    );

    summaries.forEach((summary, index) => {
      const position = this.resolveCardPosition(index, layout);
      const accent = this.colorForSeed(summary.id);
      this.fillRect(
        png,
        position.x,
        position.y,
        layout.cardWidth,
        layout.cardHeight,
        [255, 255, 255, 255],
      );
      this.drawRect(
        png,
        position.x,
        position.y,
        layout.cardWidth,
        layout.cardHeight,
        [203, 213, 225, 255],
      );
      this.fillRect(
        png,
        position.x,
        position.y,
        layout.cardWidth,
        18,
        [accent[0], accent[1], accent[2], 255],
      );

      this.drawText(
        png,
        position.x + 24,
        position.y + 32,
        this.sanitizeLabel(`SLIDE ${summary.order + 1}`),
        [15, 23, 42, 255],
        4,
      );
      this.drawText(
        png,
        position.x + 24,
        position.y + 78,
        this.sanitizeLabel(summary.name),
        [51, 65, 85, 255],
        3,
      );
      this.drawText(
        png,
        position.x + 24,
        position.y + 112,
        this.sanitizeLabel(`ELEMENTS ${summary.elementCount}`),
        [71, 85, 105, 255],
        3,
      );

      const previewX = position.x + 24;
      const previewY = position.y + 152;
      const previewWidth = layout.cardWidth - 48;
      const previewHeight = layout.cardHeight - 176;
      this.fillRect(
        png,
        previewX,
        previewY,
        previewWidth,
        previewHeight,
        [248, 250, 252, 255],
      );
      this.drawRect(
        png,
        previewX,
        previewY,
        previewWidth,
        previewHeight,
        [226, 232, 240, 255],
      );
      this.drawPreview(
        png,
        summary,
        previewX + 12,
        previewY + 12,
        previewWidth - 24,
        previewHeight - 24,
        accent,
      );
    });

    const pngBytes = PNG.sync.write(png);
    const jpegBytes = Buffer.from(
      jpeg.encode(
        {
          data: Buffer.from(png.data),
          width: png.width,
          height: png.height,
        },
        92,
      ).data,
    );

    return {
      width: png.width,
      height: png.height,
      pngBytes,
      jpegBytes,
    };
  }

  private async writePdfArtifact(
    exportId: string,
    canvas: ExportCanvasSnapshot,
    raster: RasterDocument,
  ): Promise<GeneratedArtifact> {
    const directory = path.join(this.outputRoot, canvas.id);
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(
      directory,
      `${this.slugify(canvas.name)}-${exportId}.pdf`,
    );
    await fs.writeFile(
      filePath,
      this.buildPdfBytes({
        jpegBytes: raster.jpegBytes,
        width: raster.width,
        height: raster.height,
      }),
    );
    const stats = await fs.stat(filePath);
    return { filePath, fileSize: Number(stats.size) };
  }

  private async writeImageArtifact(
    exportId: string,
    canvas: ExportCanvasSnapshot,
    raster: RasterDocument,
    format: 'PNG' | 'JPG',
  ): Promise<GeneratedArtifact> {
    const directory = path.join(this.outputRoot, canvas.id);
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(
      directory,
      `${this.slugify(canvas.name)}-${exportId}.${this.extensionFor(format)}`,
    );
    await fs.writeFile(filePath, format === 'PNG' ? raster.pngBytes : raster.jpegBytes);
    const stats = await fs.stat(filePath);
    return { filePath, fileSize: Number(stats.size) };
  }

  private toSlideSummary(slide: Slide): SlideSummary {
    return {
      id: slide.id,
      name: slide.name?.trim() || `SLIDE ${slide.order + 1}`,
      order: slide.order,
      elementCount: this.resolveElementCount(slide.elements),
    };
  }

  private resolveElementCount(elements: Prisma.JsonValue): number {
    if (Array.isArray(elements)) {
      return elements.length;
    }
    if (elements && typeof elements === 'object') {
      const record = elements as Record<string, unknown>;
      for (const key of ['elements', 'strokes', 'items', 'objects']) {
        if (Array.isArray(record[key])) {
          return (record[key] as unknown[]).length;
        }
      }
      return Object.keys(record).length;
    }
    return 0;
  }

  private resolveLayout(slideCount: number) {
    const width = 1600;
    const columns = slideCount > 1 ? 2 : 1;
    const gap = 32;
    const cardWidth = columns === 1 ? width - 96 : Math.floor((width - 96 - gap) / columns);
    const cardHeight = 290;
    const rows = Math.max(1, Math.ceil(slideCount / columns));
    const height = Math.max(900, 216 + rows * (cardHeight + gap));
    return { width, height, columns, gap, cardWidth, cardHeight };
  }

  private resolveCardPosition(
    index: number,
    layout: { columns: number; gap: number; cardWidth: number; cardHeight: number },
  ) {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    return {
      x: 48 + column * (layout.cardWidth + layout.gap),
      y: 224 + row * (layout.cardHeight + layout.gap),
    };
  }

  private fillRect(
    png: RasterCanvas,
    x: number,
    y: number,
    width: number,
    height: number,
    color: RgbaColor,
  ) {
    for (let dy = 0; dy < height; dy += 1) {
      const py = y + dy;
      if (py < 0 || py >= png.height) {
        continue;
      }
      for (let dx = 0; dx < width; dx += 1) {
        const px = x + dx;
        if (px < 0 || px >= png.width) {
          continue;
        }
        this.setPixel(png, px, py, color);
      }
    }
  }

  private drawRect(
    png: RasterCanvas,
    x: number,
    y: number,
    width: number,
    height: number,
    color: RgbaColor,
  ) {
    this.drawLine(png, x, y, x + width - 1, y, color);
    this.drawLine(png, x, y, x, y + height - 1, color);
    this.drawLine(png, x + width - 1, y, x + width - 1, y + height - 1, color);
    this.drawLine(png, x, y + height - 1, x + width - 1, y + height - 1, color);
  }

  private drawLine(
    png: RasterCanvas,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: RgbaColor,
  ) {
    let currentX = Math.round(x1);
    let currentY = Math.round(y1);
    const targetX = Math.round(x2);
    const targetY = Math.round(y2);
    const deltaX = Math.abs(targetX - currentX);
    const deltaY = Math.abs(targetY - currentY);
    const stepX = currentX < targetX ? 1 : -1;
    const stepY = currentY < targetY ? 1 : -1;
    let error = deltaX - deltaY;

    while (true) {
      this.setPixel(png, currentX, currentY, color);
      if (currentX === targetX && currentY === targetY) {
        break;
      }

      const doubleError = error * 2;
      if (doubleError > -deltaY) {
        error -= deltaY;
        currentX += stepX;
      }
      if (doubleError < deltaX) {
        error += deltaX;
        currentY += stepY;
      }
    }
  }

  private drawCircle(
    png: RasterCanvas,
    centerX: number,
    centerY: number,
    radius: number,
    color: RgbaColor,
  ) {
    const roundedRadius = Math.floor(radius);
    for (let dy = -roundedRadius; dy <= roundedRadius; dy += 1) {
      for (let dx = -roundedRadius; dx <= roundedRadius; dx += 1) {
        if (dx * dx + dy * dy <= roundedRadius * roundedRadius) {
          this.setPixel(png, centerX + dx, centerY + dy, color);
        }
      }
    }
  }

  private drawText(
    png: RasterCanvas,
    x: number,
    y: number,
    text: string,
    color: RgbaColor,
    scale = 3,
  ) {
    let cursorX = x;
    for (const rawCharacter of text.toUpperCase()) {
      const glyph = FONT_3X5[rawCharacter] ?? FONT_3X5['?'];
      glyph.forEach((row, rowIndex) => {
        row.split('').forEach((pixel, columnIndex) => {
          if (pixel !== '1') {
            return;
          }
          this.fillRect(
            png,
            cursorX + columnIndex * scale,
            y + rowIndex * scale,
            scale,
            scale,
            color,
          );
        });
      });
      cursorX += 4 * scale;
    }
  }

  private drawPreview(
    png: RasterCanvas,
    summary: SlideSummary,
    x: number,
    y: number,
    width: number,
    height: number,
    accent: [number, number, number],
  ) {
    const seed = this.hashSeed(summary.id);
    const random = this.seeded(seed);
    const shapeCount = Math.max(3, Math.min(8, summary.elementCount || 3));

    for (let index = 0; index < shapeCount; index += 1) {
      const kind = index % 3;
      const color: RgbaColor =
        kind === 0
          ? [accent[0], accent[1], accent[2], 180]
          : kind === 1
            ? [15, 23, 42, 160]
            : [56, 189, 248, 180];
      const left = x + Math.floor(random() * Math.max(1, width - 90));
      const top = y + Math.floor(random() * Math.max(1, height - 70));
      const shapeWidth = 28 + Math.floor(random() * 96);
      const shapeHeight = 18 + Math.floor(random() * 72);

      if (kind === 0) {
        this.fillRect(png, left, top, shapeWidth, shapeHeight, color);
      } else if (kind === 1) {
        this.drawLine(
          png,
          left,
          top,
          Math.min(x + width - 1, left + shapeWidth),
          Math.min(y + height - 1, top + shapeHeight),
          color,
        );
        this.drawLine(
          png,
          left,
          Math.min(y + height - 1, top + shapeHeight),
          Math.min(x + width - 1, left + shapeWidth),
          top,
          color,
        );
      } else {
        this.drawCircle(
          png,
          left + Math.floor(shapeWidth / 2),
          top + Math.floor(shapeHeight / 2),
          Math.max(8, Math.floor(Math.min(shapeWidth, shapeHeight) / 2)),
          color,
        );
      }
    }
  }

  private setPixel(png: RasterCanvas, x: number, y: number, color: RgbaColor) {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
      return;
    }
    const offset = (png.width * y + x) << 2;
    png.data[offset] = color[0];
    png.data[offset + 1] = color[1];
    png.data[offset + 2] = color[2];
    png.data[offset + 3] = color[3];
  }

  private sanitizeLabel(value: string): string {
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9 .:/?-]/g, '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 52);
  }

  private slugify(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'whiteboard-export';
  }

  private colorForSeed(seedSource: string): [number, number, number] {
    const seed = this.hashSeed(seedSource);
    return [
      64 + (seed % 128),
      96 + ((seed >>> 3) % 120),
      120 + ((seed >>> 5) % 100),
    ];
  }

  private hashSeed(value: string): number {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private seeded(seed: number) {
    let state = seed || 1;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }

  private extensionFor(format: ExportFormat | 'PDF' | 'PNG' | 'JPG'): string {
    switch (format) {
      case ExportFormat.PDF:
      case 'PDF':
        return 'pdf';
      case ExportFormat.JPG:
      case 'JPG':
        return 'jpg';
      case ExportFormat.PNG:
      case 'PNG':
      default:
        return 'png';
    }
  }

  private buildPdfBytes(options: {
    jpegBytes: Buffer;
    width: number;
    height: number;
  }): Buffer {
    const { jpegBytes, width, height } = options;
    const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentObject =
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`;

    const chunks: Buffer[] = [];
    const offsets: number[] = [];
    let length = 0;

    const push = (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
    };

    push(Buffer.from('%PDF-1.4\n', 'ascii'));
    push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const objectBlocks = [
      Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'ascii'),
      Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'ascii'),
      Buffer.from(
        `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`,
        'ascii',
      ),
      Buffer.from(contentObject, 'ascii'),
      Buffer.concat([
        Buffer.from(
          `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
          'ascii',
        ),
        jpegBytes,
        Buffer.from('\nendstream\nendobj\n', 'ascii'),
      ]),
    ];

    objectBlocks.forEach((objectBlock) => {
      offsets.push(length);
      push(objectBlock);
    });

    const xrefOffset = length;
    push(Buffer.from(`xref\n0 ${objectBlocks.length + 1}\n`, 'ascii'));
    push(Buffer.from('0000000000 65535 f \n', 'ascii'));
    offsets.forEach((offset) => {
      push(Buffer.from(`${offset.toString().padStart(10, '0')} 00000 n \n`, 'ascii'));
    });
    push(
      Buffer.from(
        `trailer\n<< /Size ${objectBlocks.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
        'ascii',
      ),
    );

    return Buffer.concat(chunks);
  }
}

export const exportService = new ExportService();
