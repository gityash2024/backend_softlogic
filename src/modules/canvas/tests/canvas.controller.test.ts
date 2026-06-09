import { UserRole } from "@prisma/client";

import { prisma } from "@/config";
import { canvasController } from "@/modules/canvas/canvas.controller";

jest.mock("@/config", () => ({
  prisma: {
    canvas: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    organizationMembership: {
      findMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  canvas: {
    count: jest.Mock;
    create: jest.Mock;
    findMany: jest.Mock;
  };
  organizationMembership: {
    findMany: jest.Mock;
  };
};

const teacherUser = (userId: string) => ({
  userId,
  role: UserRole.TEACHER,
  organizationId: "org-1",
});

const canvasRecord = (id: string, userId = "teacher-1") => ({
  id,
  userId,
  organizationId: "org-1",
  name: "Untitled Whiteboard",
  description: null,
  metadata: null,
  thumbnail: null,
  isPublic: false,
  shareToken: null,
  createdAt: new Date("2026-06-07T08:00:00.000Z"),
  updatedAt: new Date("2026-06-07T08:00:00.000Z"),
  deletedAt: null,
  slides: [],
  organization: { id: "org-1", name: "School" },
  user: { id: userId, name: "Teacher", email: "teacher@example.com" },
});

const response = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
};

describe("CanvasController database compatibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists canvases without requiring the removed clientDraftId column", async () => {
    mockedPrisma.canvas.findMany.mockResolvedValue([canvasRecord("canvas-1")]);
    mockedPrisma.canvas.count.mockResolvedValue(1);
    const res = response();
    const next = jest.fn();

    await canvasController.list(
      {
        user: teacherUser("teacher-1"),
        query: { page: "1", perPage: "100" },
      } as any,
      res as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mockedPrisma.canvas.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({
        where: expect.objectContaining({ clientDraftId: expect.anything() }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("ignores clientDraftId on create so the current database remains supported", async () => {
    mockedPrisma.canvas.create.mockResolvedValue(canvasRecord("canvas-created"));
    const res = response();
    const next = jest.fn();

    await canvasController.create(
      {
        user: teacherUser("teacher-1"),
        body: { name: "Draft", clientDraftId: "draft-1" },
      } as any,
      res as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mockedPrisma.canvas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ clientDraftId: expect.anything() }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "canvas-created" }),
        message: "Canvas created",
      }),
    );
  });
});
