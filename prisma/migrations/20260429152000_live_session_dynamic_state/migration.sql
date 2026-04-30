-- Persist a displayable session code so a teacher can reuse one code per session.
ALTER TABLE "live_sessions" ADD COLUMN "joinCode" TEXT;
