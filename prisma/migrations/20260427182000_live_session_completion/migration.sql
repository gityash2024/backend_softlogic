-- CreateEnum
CREATE TYPE "LiveSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "LiveSessionParticipantRole" AS ENUM ('HOST', 'TEACHER', 'STUDENT', 'OBSERVER');
CREATE TYPE "LiveSessionMessageType" AS ENUM ('TEXT', 'VOICE_NOTE', 'MEDIA', 'SYSTEM');
CREATE TYPE "LiveSessionMediaKind" AS ENUM ('FILE', 'IMAGE', 'VIDEO', 'VOICE_NOTE', 'IMPORT');
CREATE TYPE "LiveSessionRecordingStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'DROPBOX', 'LMS');

-- AlterTable
ALTER TABLE "live_sessions"
ADD COLUMN "hostUserId" TEXT,
ADD COLUMN "status" "LiveSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN "joinCodeHash" TEXT,
ADD COLUMN "joinCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN "studentPermissions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "endedAt" TIMESTAMP(3);

ALTER TABLE "live_session_participants"
ADD COLUMN "role" "LiveSessionParticipantRole" NOT NULL DEFAULT 'STUDENT';

-- CreateTable
CREATE TABLE "live_session_invites" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedUserId" TEXT,
    "invitedById" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "downloadPageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_session_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_session_messages" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "type" "LiveSessionMessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_session_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_session_media_assets" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" "LiveSessionMediaKind" NOT NULL DEFAULT 'FILE',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_session_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_session_recordings" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "LiveSessionRecordingStatus" NOT NULL DEFAULT 'PROCESSING',
    "storageKey" TEXT,
    "publicUrl" TEXT,
    "durationSeconds" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_session_recordings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "live_session_events" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_session_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "scopes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lms_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT,
    "encryptedConfig" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lms_sync_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "liveSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "direction" TEXT NOT NULL DEFAULT 'EXPORT',
    "payload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_sessions_organizationId_idx" ON "live_sessions"("organizationId");
CREATE INDEX "live_sessions_status_idx" ON "live_sessions"("status");
CREATE INDEX "live_session_invites_liveSessionId_idx" ON "live_session_invites"("liveSessionId");
CREATE INDEX "live_session_invites_email_idx" ON "live_session_invites"("email");
CREATE INDEX "live_session_invites_codeExpiresAt_idx" ON "live_session_invites"("codeExpiresAt");
CREATE INDEX "live_session_messages_liveSessionId_createdAt_idx" ON "live_session_messages"("liveSessionId", "createdAt");
CREATE INDEX "live_session_media_assets_liveSessionId_idx" ON "live_session_media_assets"("liveSessionId");
CREATE INDEX "live_session_recordings_liveSessionId_idx" ON "live_session_recordings"("liveSessionId");
CREATE INDEX "live_session_events_liveSessionId_createdAt_idx" ON "live_session_events"("liveSessionId", "createdAt");
CREATE UNIQUE INDEX "oauth_connections_userId_provider_key" ON "oauth_connections"("userId", "provider");
CREATE INDEX "lms_connections_userId_idx" ON "lms_connections"("userId");
CREATE INDEX "lms_sync_jobs_userId_status_idx" ON "lms_sync_jobs"("userId", "status");

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "live_session_invites" ADD CONSTRAINT "live_session_invites_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_invites" ADD CONSTRAINT "live_session_invites_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "live_session_invites" ADD CONSTRAINT "live_session_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_messages" ADD CONSTRAINT "live_session_messages_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_messages" ADD CONSTRAINT "live_session_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_media_assets" ADD CONSTRAINT "live_session_media_assets_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_recordings" ADD CONSTRAINT "live_session_recordings_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_recordings" ADD CONSTRAINT "live_session_recordings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_events" ADD CONSTRAINT "live_session_events_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_events" ADD CONSTRAINT "live_session_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lms_connections" ADD CONSTRAINT "lms_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lms_sync_jobs" ADD CONSTRAINT "lms_sync_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lms_sync_jobs" ADD CONSTRAINT "lms_sync_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "lms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
