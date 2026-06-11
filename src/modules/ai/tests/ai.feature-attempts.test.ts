import { AiFeatureUsageAttemptStatus, UserRole } from '@prisma/client';

jest.mock('@/config', () => ({
  prisma: {
    $transaction: jest.fn(),
    aiFeatureUsageAttempt: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../ai.google-billing', () => ({
  aiGoogleBillingService: {
    summary: jest.fn(),
    updateConfig: jest.fn(),
    syncNow: jest.fn(),
  },
}));

import { prisma } from '@/config';
import { aiService } from '../ai.service';

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  aiFeatureUsageAttempt: {
    count: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
};

const actor = {
  userId: 'teacher-1',
  role: UserRole.TEACHER,
  organizationId: 'org-1',
};

describe('AI feature attempt limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$transaction.mockImplementation((callback) =>
      callback({
        aiFeatureUsageAttempt: mockedPrisma.aiFeatureUsageAttempt,
      }),
    );
  });

  it('reserves a text-to-media attempt when the user is below the rolling limit', async () => {
    mockedPrisma.aiFeatureUsageAttempt.count.mockResolvedValue(1);
    mockedPrisma.aiFeatureUsageAttempt.create.mockResolvedValue({
      id: 'attempt-1',
      featureKey: 'text_to_media',
      status: AiFeatureUsageAttemptStatus.RESERVED,
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    });

    await expect(
      aiService.reserveFeatureAttempt(actor, { featureKey: 'text_to_media' }),
    ).resolves.toMatchObject({
      attemptId: 'attempt-1',
      limit: 2,
      usedInWindow: 2,
      remainingInWindow: 0,
    });
  });

  it('blocks text-to-media when two attempts already exist inside 24 hours', async () => {
    mockedPrisma.aiFeatureUsageAttempt.count.mockResolvedValue(2);

    await expect(
      aiService.reserveFeatureAttempt(actor, { featureKey: 'text_to_media' }),
    ).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(mockedPrisma.aiFeatureUsageAttempt.create).not.toHaveBeenCalled();
  });

  it('marks a reserved attempt as failed so it no longer counts in the window', async () => {
    const reserved = {
      id: 'attempt-1',
      userId: 'teacher-1',
      featureKey: 'text_to_media',
      status: AiFeatureUsageAttemptStatus.RESERVED,
      metadata: {},
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    };
    mockedPrisma.aiFeatureUsageAttempt.findFirst.mockResolvedValue(reserved);
    mockedPrisma.aiFeatureUsageAttempt.update.mockResolvedValue({
      ...reserved,
      status: AiFeatureUsageAttemptStatus.FAILED,
      updatedAt: new Date('2026-06-10T00:01:00.000Z'),
    });
    mockedPrisma.aiFeatureUsageAttempt.count.mockResolvedValue(0);

    await expect(
      aiService.failFeatureAttempt(actor, {
        featureKey: 'text_to_media',
        attemptId: 'attempt-1',
      }),
    ).resolves.toMatchObject({
      attemptId: 'attempt-1',
      status: AiFeatureUsageAttemptStatus.FAILED,
      usedInWindow: 0,
      remainingInWindow: 2,
    });
  });
});
