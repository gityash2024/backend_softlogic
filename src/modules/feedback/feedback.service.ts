import { Prisma } from '@prisma/client';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';

import type {
  AddCommentInput,
  CreateThreadInput,
  EditCommentInput,
  ListThreadsQuery,
  UpdateThreadStatusInput,
} from './feedback.validator';

const threadInclude = {
  comments: { orderBy: { createdAt: Prisma.SortOrder.asc } },
} satisfies Prisma.FeedbackThreadInclude;

export const feedbackService = {
  async listThreads({ resourceType, resourceId, includeResolved }: ListThreadsQuery) {
    const where: Prisma.FeedbackThreadWhereInput = { resourceType, resourceId };
    if (includeResolved === false) {
      where.status = 'OPEN';
    }
    return prisma.feedbackThread.findMany({
      where,
      include: threadInclude,
      orderBy: { createdAt: 'asc' },
    });
  },

  async createThread(input: CreateThreadInput) {
    const { body, authorClientId, authorName, authorEmail, ...threadData } = input;
    return prisma.feedbackThread.create({
      data: {
        resourceType: threadData.resourceType,
        resourceId: threadData.resourceId,
        anchor: (threadData.anchor ?? undefined) as Prisma.InputJsonValue | undefined,
        authorClientId,
        authorName,
        authorEmail,
        comments: {
          create: {
            body,
            authorClientId,
            authorName,
            authorEmail,
          },
        },
      },
      include: threadInclude,
    });
  },

  async getThreadById(id: string) {
    const thread = await prisma.feedbackThread.findUnique({
      where: { id },
      include: threadInclude,
    });
    if (!thread) throw new AppError('Thread not found', 404);
    return thread;
  },

  async addComment(threadId: string, input: AddCommentInput) {
    const thread = await prisma.feedbackThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new AppError('Thread not found', 404);

    return prisma.feedbackComment.create({
      data: {
        threadId,
        body: input.body,
        authorClientId: input.authorClientId,
        authorName: input.authorName,
        authorEmail: input.authorEmail,
      },
    });
  },

  async updateThreadStatus(id: string, input: UpdateThreadStatusInput) {
    const thread = await prisma.feedbackThread.findUnique({ where: { id } });
    if (!thread) throw new AppError('Thread not found', 404);

    const isResolving = input.status === 'RESOLVED';
    return prisma.feedbackThread.update({
      where: { id },
      data: {
        status: input.status,
        resolvedAt: isResolving ? new Date() : null,
        resolvedByClientId: isResolving ? input.authorClientId : null,
        resolvedByName: isResolving ? input.authorName : null,
      },
      include: threadInclude,
    });
  },

  async editComment(id: string, input: EditCommentInput) {
    const comment = await prisma.feedbackComment.findUnique({ where: { id } });
    if (!comment) throw new AppError('Comment not found', 404);
    if (comment.authorClientId !== input.authorClientId) {
      throw new AppError('Not allowed', 403);
    }

    return prisma.feedbackComment.update({
      where: { id },
      data: { body: input.body, editedAt: new Date() },
    });
  },

  async deleteComment(id: string, authorClientId: string) {
    const comment = await prisma.feedbackComment.findUnique({
      where: { id },
      include: { thread: { include: { _count: { select: { comments: true } } } } },
    });
    if (!comment) throw new AppError('Comment not found', 404);
    if (comment.authorClientId !== authorClientId) {
      throw new AppError('Not allowed', 403);
    }

    const remaining = comment.thread._count.comments - 1;

    if (remaining <= 0) {
      await prisma.feedbackThread.delete({ where: { id: comment.threadId } });
      return { deletedThread: true, threadId: comment.threadId };
    }

    await prisma.feedbackComment.delete({ where: { id } });
    return { deletedThread: false, threadId: comment.threadId };
  },
};
