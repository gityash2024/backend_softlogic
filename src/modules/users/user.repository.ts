import { prisma } from '@/config';

export class UserRepository {
  async findById(id: string) { return prisma.user.findUnique({ where: { id } }); }
  async findByEmail(email: string) { return prisma.user.findUnique({ where: { email } }); }
  async update(id: string, data: Record<string, unknown>) { return prisma.user.update({ where: { id }, data }); }
}

export const userRepository = new UserRepository();
