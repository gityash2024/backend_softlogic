import { UserRole, UserStatus } from '@prisma/client';

jest.mock('@/config', () => ({
  env: {
    PUBLIC_ADMIN_URL: 'https://admin.softlogic.test',
    PUBLIC_APP_URL: 'https://app.softlogic.test',
  },
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
  sendPasswordSetupEmail: jest.fn(),
}));

import { prisma } from '@/config';
import { adminService } from '@/modules/admin/admin.service';
import { findUserContextById } from '@/modules/users/user-context.service';
import { sendPasswordSetupEmail, sendWelcomeEmail } from '@/shared/utils/email';

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
        otp: {
          updateMany: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
        },
        organization: {
          findUnique: jest.fn(),
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

  it.each([
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.PARTNER_ADMIN,
    UserRole.CUSTOMER_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT,
  ])('sends one password setup email after an admin-created %s is persisted', async (role) => {
    const email = `${role.toLowerCase()}@example.com`;
    mockedPrisma.user.findFirst.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({
      id: `${role.toLowerCase()}-1`,
      email,
      name: `${role} Demo`,
      role,
      status: UserStatus.DISABLED,
    } as never);

    await adminService.createUser(
      { userId: 'admin-1', role: UserRole.SUPER_ADMIN },
      {
        email,
        name: `${role} Demo`,
        role,
        status: UserStatus.DISABLED,
      },
    );

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(sendPasswordSetupEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordSetupEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: email,
        name: `${role} Demo`,
        role,
        setupUrl: expect.stringContaining('/setup-password?token='),
      }),
    );
  });
});
