import { prisma } from '@/config';
import {
  GoogleDesktopAuthAttempt,
  Otp,
  OtpType,
  Prisma,
  Session,
  User,
} from '@prisma/client';

export class AuthRepository {
  async findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
      },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  async findUserByGoogleId(googleId: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        googleId,
        deletedAt: null,
      },
    });
  }

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }

  async createOtp(data: { userId: string; code: string; type: OtpType; expiresAt: Date }): Promise<Otp> {
    return prisma.otp.create({ data });
  }

  async findLatestOtp(userId: string, type: OtpType): Promise<Otp | null> {
    return prisma.otp.findFirst({
      where: { userId, type, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markOtpUsed(otpId: string): Promise<Otp> {
    return prisma.otp.update({
      where: { id: otpId },
      data: { usedAt: new Date() },
    });
  }

  async incrementOtpAttempts(otpId: string): Promise<Otp> {
    return prisma.otp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });
  }

  async invalidateUserOtps(userId: string, type: OtpType): Promise<void> {
    await prisma.otp.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  async createSession(data: { userId: string; refreshToken: string; deviceInfo?: object; ipAddress?: string; expiresAt: Date }): Promise<Session> {
    return prisma.session.create({ data: { ...data, deviceInfo: data.deviceInfo ?? undefined } });
  }

  async findSessionByToken(refreshToken: string): Promise<Session | null> {
    return prisma.session.findUnique({ where: { refreshToken } });
  }

  async deleteSession(id: string): Promise<void> {
    await prisma.session.delete({ where: { id } });
  }

  async deleteSessionByToken(refreshToken: string): Promise<void> {
    await prisma.session.delete({ where: { refreshToken } });
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    await prisma.session.deleteMany({ where: { userId } });
  }

  async countRecentOtps(userId: string, type: OtpType, since: Date): Promise<number> {
    return prisma.otp.count({
      where: { userId, type, createdAt: { gte: since } },
    });
  }

  async createGoogleDesktopAuthAttempt(data: {
    state: string;
    expiresAt: Date;
  }): Promise<GoogleDesktopAuthAttempt> {
    return prisma.googleDesktopAuthAttempt.create({ data });
  }

  async findGoogleDesktopAuthAttemptById(
    id: string,
  ): Promise<GoogleDesktopAuthAttempt | null> {
    return prisma.googleDesktopAuthAttempt.findUnique({ where: { id } });
  }

  async findGoogleDesktopAuthAttemptByState(
    state: string,
  ): Promise<GoogleDesktopAuthAttempt | null> {
    return prisma.googleDesktopAuthAttempt.findUnique({ where: { state } });
  }

  async updateGoogleDesktopAuthAttempt(
    id: string,
    data: Prisma.GoogleDesktopAuthAttemptUpdateInput,
  ): Promise<GoogleDesktopAuthAttempt> {
    return prisma.googleDesktopAuthAttempt.update({
      where: { id },
      data,
    });
  }

  async consumeGoogleDesktopAuthAttempt(id: string, consumedAt: Date): Promise<boolean> {
    const result = await prisma.googleDesktopAuthAttempt.updateMany({
      where: {
        id,
        consumedAt: null,
      },
      data: {
        consumedAt,
      },
    });

    return result.count > 0;
  }
}

export const authRepository = new AuthRepository();
