-- Support / Help thread system: org admin ↔ super admin chat with inline actions.

-- 1. Enums
CREATE TYPE "SupportCategory" AS ENUM (
  'REQUEST_SEATS',
  'EXTEND_SUBSCRIPTION',
  'RESET_DEVICE',
  'BILLING',
  'ACTIVATION_ISSUE',
  'TECHNICAL',
  'USER_MANAGEMENT',
  'GENERAL'
);

CREATE TYPE "SupportThreadStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportEventType" AS ENUM ('STATUS_CHANGE', 'ACTION_APPLIED', 'PRIORITY_CHANGE', 'REPLIED');

-- 2. support_threads
CREATE TABLE "support_threads" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "openedByUserId" TEXT NOT NULL,
  "category" "SupportCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "SupportThreadStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
  "requestedAction" JSONB,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_threads_organizationId_status_idx" ON "support_threads"("organizationId", "status");
CREATE INDEX "support_threads_status_lastActivityAt_idx" ON "support_threads"("status", "lastActivityAt");
ALTER TABLE "support_threads"
  ADD CONSTRAINT "support_threads_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_threads"
  ADD CONSTRAINT "support_threads_openedByUserId_fkey"
  FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_threads"
  ADD CONSTRAINT "support_threads_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. support_messages
CREATE TABLE "support_messages" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "editedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_messages_threadId_idx" ON "support_messages"("threadId");
ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. support_thread_events
CREATE TABLE "support_thread_events" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "type" "SupportEventType" NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_thread_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_thread_events_threadId_idx" ON "support_thread_events"("threadId");
ALTER TABLE "support_thread_events"
  ADD CONSTRAINT "support_thread_events_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_thread_events"
  ADD CONSTRAINT "support_thread_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
