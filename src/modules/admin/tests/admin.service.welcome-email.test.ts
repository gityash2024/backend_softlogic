import { UserRole, UserStatus } from '@prisma/client';

jest.mock('@/config', () => ({
  prisma: {
    $transaction: jest.fn(),
    adminAuditLog: {
      create: jest.fn(),
    },
    organizationMembership: {
      create: jest.fn(),
    },
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/modules/users/user-context.service', () => ({
  findUserContextById: jest.fn(),
}));

jest.mock('@/shared/utils/email', () => ({
  sendWelcomeEmail: jest.fn(),
}));

import { prisma } from '@/config';
import { adminService } from '@/modules/admin/admin.service';
import { findUserContextById } from '@/modules/users/user-context.service';
import { sendWelcomeEmail } from '@/shared/utils/email';

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  adminAuditLog: { create: jest.Mock };
  user: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
};

describe('AdminService welcome email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        organizationMembership: {
          create: jest.fn(),
        },
        user: {
          create: mockedPrisma.user.create,
        },
      }),
    );
    mockedPrisma.adminAuditLog.create.mockResolvedValue({} as never);
    jest.mocked(findUserContextById).mockResolvedValue({
      id: 'student-1',
      email: 'student@example.com',
      name: 'Student Demo',
      role: UserRole.STUDENT,
      status: UserStatus.DISABLED,
    } as never);
  });

  it('sends one welcome email after an admin-created user is persisted', async () => {
    mockedPrisma.user.findFirst.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({
      id: 'student-1',
      email: 'student@example.com',
      name: 'Student Demo',
      role: UserRole.STUDENT,
      status: UserStatus.DISABLED,
    } as never);

    await adminService.createUser(
      { userId: 'admin-1', role: UserRole.SUPER_ADMIN },
      {
        email: 'student@example.com',
        name: 'Student Demo',
        role: UserRole.STUDENT,
        status: UserStatus.DISABLED,
      },
    );

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.com',
        name: 'Student Demo',
        role: UserRole.STUDENT,
      }),
    );
  });
});
