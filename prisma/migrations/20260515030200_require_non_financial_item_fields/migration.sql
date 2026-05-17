/*
  Warnings:

  - You are about to drop the column `sortOrder` on the `non_financial_items` table. All the data in the column will be lost.
  - Made the column `date` on table `non_financial_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `thbRate` on table `non_financial_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `usdRate` on table `non_financial_items` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "non_financial_items_type_sortOrder_idx";

-- AlterTable
ALTER TABLE "non_financial_items" DROP COLUMN "sortOrder",
ALTER COLUMN "amountLAK" DROP DEFAULT,
ALTER COLUMN "amountTHB" DROP DEFAULT,
ALTER COLUMN "amountUSD" DROP DEFAULT,
ALTER COLUMN "date" SET NOT NULL,
ALTER COLUMN "thbRate" SET NOT NULL,
ALTER COLUMN "usdRate" SET NOT NULL;

-- CreateIndex
CREATE INDEX "non_financial_items_type_idx" ON "non_financial_items"("type");
