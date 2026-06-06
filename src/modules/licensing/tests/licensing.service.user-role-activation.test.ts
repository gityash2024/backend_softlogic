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
      teacherOnlyMode: true,
      studentLoginEnabled: false,
      parentLoginEnabled: false,
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

  it('allows active student creation even when student login is disabled', async () => {
    await expect(
      licensingService.assertCanActivateUserRole({
        organizationId: 'org-1',
        role: UserRole.STUDENT,
      }),
    ).resolves.toBeUndefined();
  });

  it('allows active parent creation even when parent login is disabled', async () => {
    await expect(
      licensingService.assertCanActivateUserRole({
        organizationId: 'org-1',
        role: UserRole.PARENT,
      }),
    ).resolves.toBeUndefined();
  });
});
