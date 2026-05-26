-- CreateEnum
CREATE TYPE "FeedbackThreadStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "feedback_threads" (
    "id" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "anchor" JSONB,
    "status" "FeedbackThreadStatus" NOT NULL DEFAULT 'OPEN',
    "authorClientId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByClientId" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "feedback_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_comments" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorClientId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_threads_resourceType_resourceId_idx" ON "feedback_threads"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "feedback_threads_status_idx" ON "feedback_threads"("status");

-- CreateIndex
CREATE INDEX "feedback_comments_threadId_idx" ON "feedback_comments"("threadId");

-- AddForeignKey
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "feedback_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
