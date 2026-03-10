import { prisma } from '@/config';

export class CanvasService {
  async findById(id: string) { return prisma.canvas.findUnique({ where: { id }, include: { slides: true } }); }
  async findByUser(userId: string) { return prisma.canvas.findMany({ where: { userId, deletedAt: null } }); }
}

export const canvasService = new CanvasService();
