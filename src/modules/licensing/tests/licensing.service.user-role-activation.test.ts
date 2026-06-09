import { OrganizationStatus, SubscriptionStatus, UserRole } from '@prisma/client';

jest.mock('@/config', () => ({
  env: {
    SMTP_HOST: 'smtp.softlogic.test',
    SMTP_PORT: 587,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    EMAIL_FROM_NAME: 'SoftLogic',
    EMAIL_FROM: 'noreply@softlogic.test',
  },
  prisma: {
    organization: {
      findUnique: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
  },
}));

import { prisma } from '@/config';
import { licensingService } from '../licensing.service';

const mockedPrisma = prisma as unknown as {
  organization: { findUnique: jest.Mock };
  subscription: { findMany: jest.Mock };
  user: { count: jest.Mock };
};

describe('LicensingService role activation checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.ACTIVE,
      deletedAt: null,
      teacherOnlyMode: false,
      studentLoginEnabled: true,
      parentLoginEnabled: true,
      teacherUserLimit: null,
      studentUserLimit: null,
      parentUserLimit: null,
    });
    mockedPrisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        seatLimit: 10,
      },
    ]);
    mockedPrisma.user.count.mockResolvedValue(2);
  });

  it('allows active student creation when the organization enables students', async () => {
    await expect(
      licensingService.assertCanActivateUserRole({
        organizationId: 'org-1',
        role: UserRole.STUDENT,
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks active student creation when student users are disabled', async () => {
    mockedPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.ACTIVE,
      deletedAt: null,
      teacherOnlyMode: false,
      studentLoginEnabled: false,
      parentLoginEnabled: false,
      teacherUserLimit: null,
      studentUserLimit: null,
      parentUserLimit: null,
    });

    await expect(
      licensingService.assertCanActivateUserRole({
        organizationId: 'org-1',
        role: UserRole.STUDENT,
      }),
    ).rejects.toThrow('Student users are not enabled for this organization');
  });

  it('blocks student and parent creation in teacher-only organizations', async () => {
    mockedPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.ACTIVE,
      deletedAt: null,
      teacherOnlyMode: true,
      studentLoginEnabled: false,
      parentLoginEnabled: false,
      teacherUserLimit: 10,
      studentUserLimit: 0,
      parentUserLimit: 0,
    });

    await expect(
      licensingService.assertCanActivateUserRole({
        organizationId: 'org-1',
        role: UserRole.PARENT,
      }),
    ).rejects.toThrow('This organization allows teacher users only');
  });

  it('blocks creation when the role-specific organization cap is full', async () => {
    mockedPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.ACTIVE,
      deletedAt: null,
      teacherOnlyMode: false,
      studentLoginEnabled: true,
      parentLoginEnabled: true,
      teacherUserLimit: 2,
      studentUserLimit: 10,
      parentUserLimit: 10,
    });
    mockedPrisma.user.count.mockResolvedValueOnce(2);

    await expect(
      licensingService.assertCanActivateUserRole({
        organizationId: 'org-1',
        role: UserRole.TEACHER,
      }),
    ).rejects.toThrow('TEACHER user limit reached for this organization');
  });
});
