import { UserRole } from '@prisma/client';

import { prisma } from '@/config';
import {
  canvasAccessMetadata,
  canvasReadWhere,
  ensureCanvasWriteAccess,
} from '@/shared/utils/access-control';

jest.mock('@/config', () => ({
  prisma: {
    canvas: {
      findFirst: jest.fn(),
    },
    organization: {
      findMany: jest.fn(),
    },
    organizationMembership: {
      findMany: jest.fn(),
    },
    parentStudentLink: {
      findMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  canvas: {
    findFirst: jest.Mock;
  };
  organizationMembership: {
    findMany: jest.Mock;
  };
};

describe('canvas access control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.organizationMembership.findMany.mockResolvedValue([]);
  });

  it('scopes teacher canvas reads to boards they created', async () => {
    await expect(
      canvasReadWhere({ userId: 'teacher-1', role: UserRole.TEACHER }),
    ).resolves.toEqual({
      deletedAt: null,
      userId: 'teacher-1',
    });
  });

  it('scopes student canvas reads to joined live-session boards only', async () => {
    await expect(
      canvasReadWhere({ userId: 'student-1', role: UserRole.STUDENT }),
    ).resolves.toEqual({
      deletedAt: null,
      liveSessions: {
        some: {
          participants: { some: { userId: 'student-1' } },
        },
      },
    });
  });

  it('allows customer admins to write boards in managed organizations', async () => {
    mockedPrisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'org-1' },
    ]);
    mockedPrisma.canvas.findFirst.mockResolvedValue({
      id: 'canvas-1',
      userId: 'teacher-1',
      organizationId: 'org-1',
      slides: [],
      organization: { id: 'org-1' },
    });

    await expect(
      ensureCanvasWriteAccess('canvas-1', {
        userId: 'admin-1',
        role: UserRole.CUSTOMER_ADMIN,
      }),
    ).resolves.toMatchObject({ id: 'canvas-1' });

    expect(mockedPrisma.canvas.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'canvas-1',
          organizationId: { in: ['org-1'] },
        }),
      }),
    );
  });

  it('reports editable access metadata for admins only inside managed scope', async () => {
    mockedPrisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'org-1' },
    ]);

    await expect(
      canvasAccessMetadata(
        { userId: 'teacher-1', organizationId: 'org-1' },
        { userId: 'admin-1', role: UserRole.CUSTOMER_ADMIN },
      ),
    ).resolves.toEqual({
      canEdit: true,
      canDelete: true,
      canHostLiveSession: true,
    });

    await expect(
      canvasAccessMetadata(
        { userId: 'teacher-2', organizationId: 'org-2' },
        { userId: 'admin-1', role: UserRole.CUSTOMER_ADMIN },
      ),
    ).resolves.toEqual({
      canEdit: false,
      canDelete: false,
      canHostLiveSession: false,
    });
  });
});
