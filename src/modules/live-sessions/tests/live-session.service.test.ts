import {
  LiveSessionMediaKind,
  LiveSessionStatus,
  UserRole,
} from "@prisma/client";

import { prisma } from "@/config";
import { liveSessionService } from "@/modules/live-sessions/live-session.service";

jest.mock("@/config", () => ({
  env: {
    PUBLIC_ADMIN_URL: "https://admin.example.com",
    PUBLIC_APP_URL: "https://app.example.com",
    PUBLIC_DOWNLOAD_PAGE_URL: "https://app.example.com/download",
    JWT_ACCESS_SECRET: "test_access_secret_minimum_32_chars",
    JWT_REFRESH_SECRET: "test_refresh_secret_minimum_32_chars",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
  },
  prisma: {
    liveSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    liveSessionParticipant: {
      upsert: jest.fn(),
    },
    liveSessionInvite: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    liveSessionEvent: {
      create: jest.fn(),
    },
    liveSessionMediaAsset: {
      create: jest.fn(),
    },
    organizationMembership: {
      upsert: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    otp: {
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/shared/utils/email", () => ({
  getBrandLogoEmailAttachments: jest.fn(() => []),
  getLiveSessionInviteEmailHtml: jest.fn(() => "<p>invite</p>"),
  sendEmail: jest.fn(),
  sendPasswordSetupEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(),
}));

import {
  sendEmail,
  sendPasswordSetupEmail,
  sendWelcomeEmail,
} from "@/shared/utils/email";

const mockedPrisma = prisma as unknown as {
  liveSession: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  liveSessionParticipant: {
    upsert: jest.Mock;
  };
  liveSessionInvite: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  liveSessionEvent: {
    create: jest.Mock;
  };
  liveSessionMediaAsset: {
    create: jest.Mock;
  };
  organizationMembership: {
    upsert: jest.Mock;
  };
  organization: {
    findUnique: jest.Mock;
  };
  otp: {
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

describe("LiveSessionService permissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.organization.findUnique.mockResolvedValue(null);
    mockedPrisma.otp.updateMany.mockResolvedValue({ count: 0 });
    mockedPrisma.otp.create.mockResolvedValue({ id: "otp-1" });
  });

  it("prevents students from creating live sessions", async () => {
    await expect(
      liveSessionService.createSession(
        { userId: "student-1", role: UserRole.STUDENT },
        { canvasId: "canvas-1", title: "Class" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("prevents students from uploading media even with session access", async () => {
    mockedPrisma.liveSession.findUnique.mockResolvedValue({
      id: "live-1",
      createdById: "teacher-1",
      hostUserId: "teacher-1",
      participants: [{ userId: "student-1" }],
      invites: [],
    });

    await expect(
      liveSessionService.createMediaAsset(
        { userId: "student-1", role: UserRole.STUDENT },
        "live-1",
        {
          kind: LiveSessionMediaKind.FILE,
          publicUrl: "https://example.com/file.pdf",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("queries only active unused join codes", async () => {
    mockedPrisma.liveSession.findFirst.mockResolvedValue(null);
    mockedPrisma.liveSessionInvite.findFirst.mockResolvedValue(null);

    await expect(
      liveSessionService.verifyJoinCode("ABC123"),
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockedPrisma.liveSessionInvite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usedAt: null,
          codeExpiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });

  it("lists only teacher-owned live sessions for teacher users", async () => {
    mockedPrisma.liveSession.findMany.mockResolvedValue([]);

    await liveSessionService.listSessions(
      { userId: "teacher-1", role: UserRole.TEACHER },
      { status: LiveSessionStatus.LIVE },
    );

    expect(mockedPrisma.liveSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "LIVE",
          OR: [
            { createdById: "teacher-1" },
            { hostUserId: "teacher-1" },
            { canvas: { userId: "teacher-1" } },
          ],
        }),
      }),
    );
  });

  it("backfills legacy live session host and organization when a teacher starts it", async () => {
    mockedPrisma.liveSession.findUnique
      .mockResolvedValueOnce({
        id: "live-1",
        createdById: "teacher-1",
        hostUserId: null,
        organizationId: null,
        canvas: { userId: "teacher-1", organizationId: "org-1" },
      })
      .mockResolvedValueOnce({
        hostUserId: null,
        organizationId: null,
        canvas: { organizationId: "org-1" },
      });
    mockedPrisma.liveSession.update.mockResolvedValue({
      id: "live-1",
      status: LiveSessionStatus.LIVE,
    });
    mockedPrisma.liveSessionEvent.create.mockResolvedValue({});

    await liveSessionService.startSession(
      { userId: "teacher-1", role: UserRole.TEACHER },
      "live-1",
    );

    expect(mockedPrisma.liveSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "live-1" },
        data: expect.objectContaining({
          status: LiveSessionStatus.LIVE,
          hostUserId: "teacher-1",
          organizationId: "org-1",
        }),
      }),
    );
  });

  it("lists only joined live sessions for student users", async () => {
    mockedPrisma.liveSession.findMany.mockResolvedValue([]);

    await liveSessionService.listSessions(
      {
        userId: "student-1",
        email: "student@example.com",
        role: UserRole.STUDENT,
      },
      { status: LiveSessionStatus.LIVE },
    );

    expect(mockedPrisma.liveSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "LIVE",
          OR: [{ participants: { some: { userId: "student-1" } } }],
        }),
      }),
    );
  });

  it("generates a reusable session-wide join code for teachers", async () => {
    mockedPrisma.liveSession.findUnique.mockResolvedValue({
      id: "live-1",
      canvasId: "canvas-1",
      organizationId: "org-1",
      title: "Math Class",
      createdById: "teacher-1",
      hostUserId: "teacher-1",
      createdBy: {
        email: "teacher@example.com",
        name: "Teacher Demo",
      },
    });
    mockedPrisma.liveSession.update.mockResolvedValue({});
    mockedPrisma.liveSessionEvent.create.mockResolvedValue({});

    const result = await liveSessionService.generateSessionJoinCode(
      { userId: "teacher-1", role: UserRole.TEACHER },
      "live-1",
      { expiresInMinutes: 15 },
    );

    expect(result.code).toMatch(/^[A-F0-9]{6}$/);
    expect(mockedPrisma.liveSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "live-1" },
        data: expect.objectContaining({
          joinCodeHash: expect.any(String),
          joinCodeExpiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it("sends password setup email once when a live-session invite creates a user and student login is enabled", async () => {
    mockedPrisma.liveSession.findUnique.mockResolvedValue({
      id: "live-1",
      organizationId: "org-1",
      title: "Math Class",
      createdById: "teacher-1",
      hostUserId: "teacher-1",
      createdBy: {
        email: "teacher@example.com",
        name: "Teacher Demo",
      },
    });
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.upsert.mockResolvedValue({
      id: "student-1",
      email: "student@example.com",
      name: "student",
      role: UserRole.STUDENT,
    });
    mockedPrisma.organization.findUnique.mockResolvedValue({
      name: "SoftLogic Academy",
      studentLoginEnabled: true,
    });
    mockedPrisma.organizationMembership.upsert.mockResolvedValue({});
    mockedPrisma.liveSessionInvite.create.mockResolvedValue({
      id: "invite-1",
      email: "student@example.com",
      codeExpiresAt: new Date("2026-04-28T12:00:00.000Z"),
      downloadPageUrl: "https://app.example.com/download",
    });
    mockedPrisma.liveSessionEvent.create.mockResolvedValue({});

    await liveSessionService.inviteStudent(
      { userId: "teacher-1", role: UserRole.TEACHER },
      "live-1",
      {
        email: "student@example.com",
        expiresInMinutes: 15,
      },
    );

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(sendPasswordSetupEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordSetupEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "student@example.com",
        name: "student",
        role: UserRole.STUDENT,
        organizationName: "SoftLogic Academy",
        setupUrl: expect.stringContaining("/setup-password?token="),
      }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send a welcome email when a live-session invite updates an existing user", async () => {
    mockedPrisma.liveSession.findUnique.mockResolvedValue({
      id: "live-1",
      organizationId: "org-1",
      title: "Math Class",
      createdById: "teacher-1",
      hostUserId: "teacher-1",
      createdBy: {
        email: "teacher@example.com",
        name: "Teacher Demo",
      },
    });
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "student-1" });
    mockedPrisma.user.upsert.mockResolvedValue({
      id: "student-1",
      email: "student@example.com",
      name: "Student Demo",
      role: UserRole.STUDENT,
    });
    mockedPrisma.organizationMembership.upsert.mockResolvedValue({});
    mockedPrisma.liveSessionInvite.create.mockResolvedValue({
      id: "invite-1",
      email: "student@example.com",
      codeExpiresAt: new Date("2026-04-28T12:00:00.000Z"),
      downloadPageUrl: "https://app.example.com/download",
    });
    mockedPrisma.liveSessionEvent.create.mockResolvedValue({});

    await liveSessionService.inviteStudent(
      { userId: "teacher-1", role: UserRole.TEACHER },
      "live-1",
      {
        email: "student@example.com",
        expiresInMinutes: 15,
      },
    );

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
