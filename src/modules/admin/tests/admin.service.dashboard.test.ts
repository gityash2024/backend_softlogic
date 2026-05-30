import {
  ExportStatus,
  LiveSessionStatus,
  OrganizationKind,
  OrganizationStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

jest.mock('@/config', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    organization: { findMany: jest.fn() },
    subscription: { findMany: jest.fn() },
    canvas: { count: jest.fn() },
    liveSession: { findMany: jest.fn() },
    export: { findMany: jest.fn() },
    adminAuditLog: { findMany: jest.fn() },
  },
}));

jest.mock('@/shared/utils/access-control', () => ({
  getManagedOrganizationIds: jest.fn(),
  canManageRole: jest.fn(),
  ensureOrganizationManaged: jest.fn(),
}));

jest.mock('@/shared/utils/email', () => ({
  sendWelcomeEmail: jest.fn(),
}));

import { prisma } from '@/config';
import { adminService } from '@/modules/admin/admin.service';
import { getManagedOrganizationIds } from '@/shared/utils/access-control';

const mockedPrisma = prisma as unknown as {
  user: { findMany: jest.Mock };
  organization: { findMany: jest.Mock };
  subscription: { findMany: jest.Mock };
  canvas: { count: jest.Mock };
  liveSession: { findMany: jest.Mock };
  export: { findMany: jest.Mock };
  adminAuditLog: { findMany: jest.Mock };
};

const mockedGetManagedOrganizationIds = jest.mocked(getManagedOrganizationIds);

describe('AdminService dashboard overview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.user.findMany.mockResolvedValue([]);
    mockedPrisma.organization.findMany.mockResolvedValue([]);
    mockedPrisma.subscription.findMany.mockResolvedValue([]);
    mockedPrisma.canvas.count.mockResolvedValue(0);
    mockedPrisma.liveSession.findMany.mockResolvedValue([]);
    mockedPrisma.export.findMany.mockResolvedValue([]);
    mockedPrisma.adminAuditLog.findMany.mockResolvedValue([]);
  });

  it('returns scoped metrics for managed organizations', async () => {
    const now = new Date();
    mockedGetManagedOrganizationIds.mockResolvedValue(['org-1']);
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 'teacher-1',
        role: UserRole.TEACHER,
        status: UserStatus.ACTIVE,
        createdAt: now,
        lastLoginAt: null,
      },
      {
        id: 'student-1',
        role: UserRole.STUDENT,
        status: UserStatus.DISABLED,
        createdAt: now,
        lastLoginAt: null,
      },
    ]);
    mockedPrisma.organization.findMany.mockResolvedValue([
      {
        id: 'org-1',
        kind: OrganizationKind.CUSTOMER,
        status: OrganizationStatus.ACTIVE,
        createdAt: now,
      },
    ]);
    mockedPrisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        seatLimit: 10,
        seatUsage: 6,
        createdAt: now,
        endDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
    ]);
    mockedPrisma.canvas.count.mockResolvedValue(4);
    mockedPrisma.liveSession.findMany.mockResolvedValue([
      { id: 'live-1', status: LiveSessionStatus.LIVE, createdAt: now },
    ]);
    mockedPrisma.export.findMany.mockResolvedValue([
      {
        id: 'export-1',
        status: ExportStatus.COMPLETED,
        fileSize: 512,
        createdAt: now,
      },
    ]);
    mockedPrisma.adminAuditLog.findMany
      .mockResolvedValueOnce([
        {
          id: 'audit-1',
          actorUserId: 'admin-1',
          action: 'user.update',
          targetType: 'user',
          targetId: 'student-1',
          summary: 'Updated user student@example.com',
          metadata: null,
          createdAt: now,
          actorUser: {
            id: 'admin-1',
            email: 'admin@example.com',
            name: 'Admin',
            role: UserRole.CUSTOMER_ADMIN,
          },
        },
      ])
      .mockResolvedValueOnce([{ createdAt: now }]);

    const overview = await adminService.getDashboardOverview({
      userId: 'admin-1',
      role: UserRole.CUSTOMER_ADMIN,
      organizationId: 'org-1',
    });

    expect(overview.scope).toEqual({
      type: 'MANAGED',
      organizationIds: ['org-1'],
    });
    expect(overview.users.total).toBe(2);
    expect(overview.users.active).toBe(1);
    expect(overview.subscriptions.seatUsage).toBe(6);
    expect(overview.subscriptions.utilizationRate).toBe(60);
    expect(overview.content.canvases.total).toBe(4);
    expect(overview.activity.recent).toHaveLength(1);
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: expect.arrayContaining([
            { id: 'admin-1' },
            { primaryOrganizationId: { in: ['org-1'] } },
          ]),
        }),
      }),
    );
  });

  it('uses global scope for super admins', async () => {
    mockedGetManagedOrganizationIds.mockResolvedValue(null);

    await adminService.getDashboardOverview({
      userId: 'super-1',
      role: UserRole.SUPER_ADMIN,
    });

    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(mockedPrisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(mockedPrisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(mockedPrisma.canvas.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });
});
