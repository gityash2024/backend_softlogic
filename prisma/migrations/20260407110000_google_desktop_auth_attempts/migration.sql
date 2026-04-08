-- CreateEnum
CREATE TYPE "GoogleDesktopAuthAttemptStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "google_desktop_auth_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "state" TEXT NOT NULL,
    "status" "GoogleDesktopAuthAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "sessionPayload" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_desktop_auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_desktop_auth_attempts_state_key" ON "google_desktop_auth_attempts"("state");

-- CreateIndex
CREATE INDEX "google_desktop_auth_attempts_status_expiresAt_idx" ON "google_desktop_auth_attempts"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "google_desktop_auth_attempts" ADD CONSTRAINT "google_desktop_auth_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
