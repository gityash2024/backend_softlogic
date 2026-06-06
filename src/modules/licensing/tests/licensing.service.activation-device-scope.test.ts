import {
  HardwareActivationKeyStatus,
  HardwareActivationStatus,
  OrganizationStatus,
  SubscriptionStatus,
} from '@prisma/client';

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
    $transaction: jest.fn(),
    hardwareActivationKey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    hardwareActivation: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '@/config';
import { licensingService } from '../licensing.service';

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  hardwareActivationKey: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  hardwareActivation: {
    findUnique: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
};

const activeKey = {
  id: 'key-1',
  organizationId: 'org-1',
  subscriptionId: 'sub-1',
  status: HardwareActivationKeyStatus.BOUND,
  maxDevices: 1,
  expiresAt: new Date(Date.now() + 86400000),
  boundActivationId: 'activation-1',
  assignedUserId: 'teacher-1',
  organization: {
    id: 'org-1',
    name: 'School Org',
    status: OrganizationStatus.ACTIVE,
    deletedAt: null,
  },
  subscription: {
    id: 'sub-1',
    status: SubscriptionStatus.ACTIVE,
    endDate: new Date(Date.now() + 86400000),
  },
  boundActivation: {
    id: 'activation-1',
    devicePlatform: 'windows',
    deviceModel: 'Classroom Panel',
    deviceOsVersion: '11',
    firstBoundAt: new Date('2026-06-01T00:00:00Z'),
  },
};

const activeDeviceActivation = {
  id: 'activation-1',
  activationKeyId: 'key-1',
  organizationId: 'org-1',
  userId: 'teacher-1',
  status: HardwareActivationStatus.ACTIVE,
  firstBoundAt: new Date('2026-06-01T00:00:00Z'),
  lastVerifiedAt: new Date('2026-06-01T00:00:00Z'),
};

describe('LicensingService device-scoped activation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.hardwareActivationKey.findUnique.mockResolvedValue(activeKey);
    mockedPrisma.user.findUnique.mockResolvedValue({
      primaryOrganizationId: 'org-1',
    });
    mockedPrisma.hardwareActivation.findUnique.mockResolvedValue(
      activeDeviceActivation,
    );
    mockedPrisma.hardwareActivation.update.mockResolvedValue({
      ...activeDeviceActivation,
      lastVerifiedAt: new Date('2026-06-05T00:00:00Z'),
    });
    mockedPrisma.hardwareActivationKey.update.mockResolvedValue(activeKey);
  });

  it('allows a different same-organization user to use an already activated board device', async () => {
    const result = await licensingService.verifyHardwareActivation({
      activationKey: 'SL-KEY',
      deviceFingerprint: 'panel-fingerprint',
      userId: 'teacher-2',
    });

    expect(result).toMatchObject({
      valid: true,
      organizationId: 'org-1',
      organizationName: 'School Org',
      subscriptionId: 'sub-1',
    });
    expect(mockedPrisma.hardwareActivation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activation-1' },
      }),
    );
  });

  it('rejects users from another organization on the same activated device', async () => {
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      primaryOrganizationId: 'org-2',
    });

    await expect(
      licensingService.verifyHardwareActivation({
        activationKey: 'SL-KEY',
        deviceFingerprint: 'panel-fingerprint',
        userId: 'other-org-user',
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: 'organization_mismatch',
    });
  });

  it('blocks a second physical device when maxDevices is one', async () => {
    const tx = {
      hardwareActivationKey: {
        findUnique: jest.fn().mockResolvedValue({
          ...activeKey,
          status: HardwareActivationKeyStatus.BOUND,
        }),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          primaryOrganizationId: 'org-1',
        }),
      },
      hardwareActivation: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    await expect(
      licensingService.bindHardwareActivation({
        activationKey: 'SL-KEY',
        deviceFingerprint: 'second-panel',
        userId: 'teacher-2',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Activation key is already bound to another device',
    });
  });

  it('allows another physical device when maxDevices has available capacity', async () => {
    const createdActivation = {
      ...activeDeviceActivation,
      id: 'activation-2',
      deviceFingerprintHash: 'hash-2',
    };
    const tx = {
      hardwareActivationKey: {
        findUnique: jest.fn().mockResolvedValue({
          ...activeKey,
          maxDevices: 10,
        }),
        update: jest.fn().mockResolvedValue(activeKey),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          primaryOrganizationId: 'org-1',
        }),
      },
      hardwareActivation: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(createdActivation),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    await expect(
      licensingService.bindHardwareActivation({
        activationKey: 'SL-KEY',
        deviceFingerprint: 'second-panel',
        userId: 'teacher-2',
      }),
    ).resolves.toMatchObject({ id: 'activation-2' });
  });
});
