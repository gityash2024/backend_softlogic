import { UserRole, UserStatus } from '@prisma/client';

jest.mock('@/config', () => ({
  env: {
    SMTP_HOST: 'smtp.softlogic.test',
    SMTP_PORT: 587,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    EMAIL_FROM_NAME: 'SoftLogic',
    EMAIL_FROM: 'noreply@softlogic.test',
    PUBLIC_ADMIN_URL: 'https://admin.softlogic.test',
    PUBLIC_APP_URL: 'https://app.softlogic.test',
  },
  prisma: {
    user: {
      findFirst: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/modules/users/user-context.service', () => ({
  findUserContextById: jest.fn(),
}));

import { prisma } from '@/config';
import { adminService } from '../admin.service';

const mockedPrisma = prisma as unknown as {
  user: { findFirst: jest.Mock };
  subscription: { findFirst: jest.Mock };
};

describe('AdminService parent links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns linked student ids and summaries on parent detail', async () => {
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: 'parent-1',
      email: 'parent@example.com',
      name: 'Parent User',
      role: UserRole.PARENT,
      status: UserStatus.ACTIVE,
      primaryOrganizationId: 'org-1',
      primaryOrganization: { id: 'org-1', name: 'Demo Org' },
      parentLinks: [
        {
          studentUserId: 'student-1',
          studentUser: {
            id: 'student-1',
            email: 'student@example.com',
            name: 'Student User',
            status: UserStatus.ACTIVE,
            primaryOrganizationId: 'org-1',
          },
        },
      ],
    });
    mockedPrisma.subscription.findFirst.mockResolvedValue(null);

    const result = await adminService.getUser(
      { userId: 'admin-1', role: UserRole.SUPER_ADMIN },
      'parent-1',
    );

    expect(result.linkedStudentIds).toEqual(['student-1']);
    expect(result.linkedStudents).toEqual([
      expect.objectContaining({
        id: 'student-1',
        email: 'student@example.com',
      }),
    ]);
  });
});
