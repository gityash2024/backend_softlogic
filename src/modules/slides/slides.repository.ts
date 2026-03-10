import { prisma } from '@/config';

export class SlidesRepository {
  async findById(id: string) { return prisma.slide.findUnique({ where: { id } }); }
}

export const slidesRepository = new SlidesRepository();
