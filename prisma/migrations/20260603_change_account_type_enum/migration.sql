-- Migration: Change AccountType enum from (USABLE, STUCK, COLLATERAL, FUND)
--            to (SAVINGS, CURRENT, FIXED_DEPOSIT)
--
-- Data mapping:
--   USABLE              → SAVINGS
--   STUCK               → FIXED_DEPOSIT
--   COLLATERAL          → FIXED_DEPOSIT
--   FUND                → FIXED_DEPOSIT

-- Step 1: Add new enum values to the existing type
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'SAVINGS';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'CURRENT';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'FIXED_DEPOSIT';

-- Step 2: Migrate existing row data to new values
UPDATE "bank_accounts" SET "accountType" = 'SAVINGS'       WHERE "accountType" = 'USABLE';
UPDATE "bank_accounts" SET "accountType" = 'FIXED_DEPOSIT' WHERE "accountType" IN ('STUCK', 'COLLATERAL', 'FUND');

-- Step 3: Swap the enum type (PostgreSQL requires recreating to drop old values)
ALTER TYPE "AccountType" RENAME TO "AccountType_old";

CREATE TYPE "AccountType" AS ENUM ('SAVINGS', 'CURRENT', 'FIXED_DEPOSIT');

ALTER TABLE "bank_accounts"
  ALTER COLUMN "accountType" TYPE "AccountType"
  USING "accountType"::text::"AccountType";

ALTER TABLE "bank_accounts"
  ALTER COLUMN "accountType" SET DEFAULT 'SAVINGS'::"AccountType";

DROP TYPE "AccountType_old";
