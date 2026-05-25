-- AlterTable: add bankAccountId to non_financial_items
ALTER TABLE "non_financial_items" ADD COLUMN "bankAccountId" TEXT;

-- Backfill existing rows with the first available bank account (if any exist).
-- If there are no bank accounts, existing rows must be removed to satisfy NOT NULL.
UPDATE "non_financial_items"
SET "bankAccountId" = (SELECT "id" FROM "bank_accounts" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "bankAccountId" IS NULL;

DELETE FROM "non_financial_items" WHERE "bankAccountId" IS NULL;

ALTER TABLE "non_financial_items" ALTER COLUMN "bankAccountId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "non_financial_items_bankAccountId_idx" ON "non_financial_items"("bankAccountId");

-- AddForeignKey
ALTER TABLE "non_financial_items" ADD CONSTRAINT "non_financial_items_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
