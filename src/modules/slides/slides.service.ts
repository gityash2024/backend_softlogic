import { prisma } from '@/config';

export class SlidesService {
  async findByCanvas(canvasId: string) { return prisma.slide.findMany({ where: { canvasId }, orderBy: { order: 'asc' } }); }
}

export const slidesService = new SlidesService();
