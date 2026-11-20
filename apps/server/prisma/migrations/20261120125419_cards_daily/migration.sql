-- CreateTable
CREATE TABLE "CardsDailyEntry" (
    "date" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "climbed" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "hp" INTEGER NOT NULL,
    "chassis" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardsDailyEntry_pkey" PRIMARY KEY ("date","userId")
);

-- CreateIndex
CREATE INDEX "CardsDailyEntry_date_score_idx" ON "CardsDailyEntry"("date", "score");

-- AddForeignKey
ALTER TABLE "CardsDailyEntry" ADD CONSTRAINT "CardsDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
