-- AlterTable
ALTER TABLE "canvases" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "canvases_shareToken_key" ON "canvases"("shareToken");
