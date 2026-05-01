-- CreateTable
CREATE TABLE "TranslationCache" (
    "id" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranslationCache_sourceLanguage_targetLanguage_sourceHash_key" ON "TranslationCache"("sourceLanguage", "targetLanguage", "sourceHash");

-- CreateIndex
CREATE INDEX "TranslationCache_targetLanguage_idx" ON "TranslationCache"("targetLanguage");
