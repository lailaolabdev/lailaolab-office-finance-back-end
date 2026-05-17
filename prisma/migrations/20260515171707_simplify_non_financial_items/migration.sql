/*
  Warnings:

  - You are about to drop the column `amountLAK` on the `non_financial_items` table. All the data in the column will be lost.
  - You are about to drop the column `amountTHB` on the `non_financial_items` table. All the data in the column will be lost.
  - You are about to drop the column `amountUSD` on the `non_financial_items` table. All the data in the column will be lost.
  - You are about to drop the column `note` on the `non_financial_items` table. All the data in the column will be lost.
  - You are about to drop the column `thbRate` on the `non_financial_items` table. All the data in the column will be lost.
  - You are about to drop the column `usdRate` on the `non_financial_items` table. All the data in the column will be lost.

*/
-- AlterTable: add new columns
ALTER TABLE "non_financial_items"
  ADD COLUMN "amount" DECIMAL(20, 2),
  ADD COLUMN "currency" TEXT;

-- Backfill: copy amountLAK into amount, default currency to 'LAK'
UPDATE "non_financial_items"
SET "amount" = "amountLAK",
    "currency" = 'LAK';

-- Enforce NOT NULL on amount
ALTER TABLE "non_financial_items"
  ALTER COLUMN "amount" SET NOT NULL;

-- Drop old columns
ALTER TABLE "non_financial_items"
  DROP COLUMN "amountLAK",
  DROP COLUMN "amountTHB",
  DROP COLUMN "amountUSD",
  DROP COLUMN "note",
  DROP COLUMN "thbRate",
  DROP COLUMN "usdRate";
