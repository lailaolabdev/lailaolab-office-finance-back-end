-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('EXPENSE', 'INCOME');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "type" "CategoryType" NOT NULL DEFAULT 'EXPENSE';

-- CreateIndex
CREATE INDEX "categories_type_idx" ON "categories"("type");
