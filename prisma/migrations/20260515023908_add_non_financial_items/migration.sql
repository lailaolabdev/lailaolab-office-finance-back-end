-- CreateEnum
CREATE TYPE "NonFinancialItemType" AS ENUM ('WITHHELD', 'UNUSABLE');

-- CreateTable
CREATE TABLE "non_financial_items" (
    "id" TEXT NOT NULL,
    "type" "NonFinancialItemType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "amountLAK" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountTHB" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountUSD" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalInLAK" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3),
    "thbRate" DECIMAL(20,6),
    "usdRate" DECIMAL(20,6),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_financial_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "non_financial_items_type_sortOrder_idx" ON "non_financial_items"("type", "sortOrder");
