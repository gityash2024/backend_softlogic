ALTER TABLE "canvases" ADD COLUMN "clientDraftId" TEXT;

CREATE UNIQUE INDEX "canvases_userId_clientDraftId_key"
  ON "canvases"("userId", "clientDraftId");
