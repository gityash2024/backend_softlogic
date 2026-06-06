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

  /**
   * Finds a soft-deleted account that still owns this email address. On admin
   * delete the live `email` is tombstoned and the original is preserved in
   * `archivedEmail`; on self-delete the `email` is left intact. Matching either
   * (case-insensitively) lets login surface a "suspended" message until a brand
   * new account claims the same address.
   */
  async findDeletedUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim();
    if (!normalized) {
      return null;
    }
    return prisma.user.findFirst({
      where: {
        deletedAt: { not: null },
        OR: [
          { email: { equals: normalized, mode: 'insensitive' } },
          { archivedEmail: { equals: normalized, mode: 'insensitive' } },
        ],
      },
      orderBy: { deletedAt: 'desc' },
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

  async findOtpById(id: string): Promise<
    Prisma.OtpGetPayload<{ include: { user: true } }> | null
  > {
    return prisma.otp.findUnique({
      where: { id },
      include: { user: true },
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

  async createSession(data: {
    userId: string;
    refreshToken?: string | null;
    clientSessionId?: string | null;
    deviceInfo?: object;
    ipAddress?: string | null;
    expiresAt: Date;
    createdAt?: Date;
    lastSeenAt?: Date;
  }): Promise<Session> {
    return prisma.session.create({
      data: {
        ...data,
        refreshToken: data.refreshToken ?? undefined,
        clientSessionId: data.clientSessionId ?? undefined,
        deviceInfo: data.deviceInfo ?? undefined,
        ipAddress: data.ipAddress ?? undefined,
      },
    });
  }

  async findSessionByToken(refreshToken: string): Promise<Session | null> {
    if (!refreshToken.trim()) {
      return null;
    }
    return prisma.session.findUnique({ where: { refreshToken } });
  }

  async findUserSessionByClientSessionId(
    userId: string,
    clientSessionId: string,
  ): Promise<Session | null> {
    return prisma.session.findUnique({
      where: { userId_clientSessionId: { userId, clientSessionId } },
    });
  }

  async listUserSessions(userId: string): Promise<Session[]> {
    return prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUserSessionById(
    userId: string,
    sessionId: string,
  ): Promise<Session | null> {
    return prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
  }

  async updateSession(
    id: string,
    data: Prisma.SessionUpdateInput,
  ): Promise<Session> {
    return prisma.session.update({ where: { id }, data });
  }

  async deleteSession(id: string): Promise<void> {
    await prisma.session.update({
      where: { id },
      data: { refreshToken: null, revokedAt: new Date() },
    });
  }

  async deleteSessionByToken(refreshToken: string): Promise<void> {
    await prisma.session.updateMany({
      where: { refreshToken },
      data: { refreshToken: null, revokedAt: new Date() },
    });
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { refreshToken: null, revokedAt: new Date() },
    });
  }

  async deleteOtherUserSessions(
    userId: string,
    keepRefreshToken: string,
  ): Promise<void> {
    await prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ refreshToken: { not: keepRefreshToken } }, { refreshToken: null }],
      },
      data: { refreshToken: null, revokedAt: new Date() },
    });
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
