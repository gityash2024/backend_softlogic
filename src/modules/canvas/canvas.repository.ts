import { prisma } from '@/config';

export class CanvasRepository {
  async findById(id: string) { return prisma.canvas.findUnique({ where: { id } }); }
  async create(data: { userId: string; name: string; description?: string }) { return prisma.canvas.create({ data }); }
}

export const canvasRepository = new CanvasRepository();
