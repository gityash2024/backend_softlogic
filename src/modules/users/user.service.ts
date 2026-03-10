import { User } from '@prisma/client';
import { prisma } from '@/config';

export class UserService {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id, deletedAt: null } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email, deletedAt: null } });
  }

  async update(id: string, data: Partial<Pick<User, 'name' | 'avatar' | 'timezone' | 'language'>>): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

export const userService = new UserService();
