import { UserRole } from "@prisma/client";

import { prisma } from "@/config";
import { canvasController } from "@/modules/canvas/canvas.controller";

jest.mock("@/config", () => ({
  prisma: {
    canvas: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  canvas: {
    create: jest.Mock;
    findFirst: jest.Mock;
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
  clientDraftId: "draft-1",
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

describe("CanvasController create idempotency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the existing active canvas for the same user and clientDraftId", async () => {
    const existing = canvasRecord("canvas-existing");
    mockedPrisma.canvas.findFirst.mockResolvedValue(existing);
    const res = response();
    const next = jest.fn();

    await canvasController.create(
      {
        user: teacherUser("teacher-1"),
        body: { name: "Untitled Whiteboard", clientDraftId: " draft-1 " },
      } as any,
      res as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mockedPrisma.canvas.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "teacher-1",
          clientDraftId: "draft-1",
          deletedAt: null,
        },
      }),
    );
    expect(mockedPrisma.canvas.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "canvas-existing" }),
        message: "Canvas already exists for draft",
      }),
    );
  });

  it("keeps normal create behavior when clientDraftId is absent", async () => {
    const created = canvasRecord("canvas-created");
    mockedPrisma.canvas.create.mockResolvedValue(created);
    const res = response();
    const next = jest.fn();

    await canvasController.create(
      {
        user: teacherUser("teacher-1"),
        body: { name: "Untitled Whiteboard" },
      } as any,
      res as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mockedPrisma.canvas.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.canvas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "teacher-1",
          clientDraftId: undefined,
        }),
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

  it("allows different users to create with the same clientDraftId", async () => {
    mockedPrisma.canvas.findFirst.mockResolvedValue(null);
    mockedPrisma.canvas.create
      .mockResolvedValueOnce(canvasRecord("canvas-user-1", "teacher-1"))
      .mockResolvedValueOnce(canvasRecord("canvas-user-2", "teacher-2"));

    const firstRes = response();
    const secondRes = response();

    await canvasController.create(
      {
        user: teacherUser("teacher-1"),
        body: { name: "Draft", clientDraftId: "draft-1" },
      } as any,
      firstRes as any,
      jest.fn(),
    );
    await canvasController.create(
      {
        user: teacherUser("teacher-2"),
        body: { name: "Draft", clientDraftId: "draft-1" },
      } as any,
      secondRes as any,
      jest.fn(),
    );

    expect(mockedPrisma.canvas.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.canvas.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "teacher-1",
          clientDraftId: "draft-1",
        }),
      }),
    );
    expect(mockedPrisma.canvas.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "teacher-2",
          clientDraftId: "draft-1",
        }),
      }),
    );
  });
});
