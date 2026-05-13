import { createHash } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { Currency, Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { BadRequestError, ConflictError } from '../utils/errors';
import { parseStatement, ParsedStatement, BankTemplate } from './bankParsers';

interface IngestParams {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  bankAccountId: string;
  companyId: string;
  uploadedById: string;
  forceTemplate?: BankTemplate;
  defaultCategoryId?: string;
  // per-row category override: rowNumber -> categoryId
  rowCategories?: Record<number, string>;
  // row numbers to skip entirely (user deleted them in preview)
  excludedRows?: Set<number>;
  currency?: Currency;
  dryRun?: boolean;
}

interface IngestResult {
  statementFileId: string | null;
  template: BankTemplate;
  totalRows: number;
  created: number;
  duplicateInBatch: number;
  warnings: string[];
  preview: Array<{
    rowNumber: number;
    transactionDate: string;
    description: string;
    amount: number;
    type: TransactionType;
    bankReference: string | null;
  }>;
}

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function persistFile(buffer: Buffer, hash: string, fileName: string): Promise<string> {
  const dir = join(process.cwd(), 'uploads', 'statements');
  await mkdir(dir, { recursive: true });
  const ext = fileName.split('.').pop() || 'xlsx';
  const path = join(dir, `${hash}.${ext}`);
  await writeFile(path, buffer);
  return path;
}

function generateReference(type: TransactionType): string {
  const prefix = type === 'INCOME' ? 'IN' : type === 'EXPENSE' ? 'EX' : 'TF';
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${date}-${random}`;
}

export const importService = {
  /**
   * Parse-only: inspect file, detect bank, return preview rows. Does NOT touch the DB.
   */
  parse(buffer: Buffer, forceTemplate?: BankTemplate): ParsedStatement {
    return parseStatement(buffer, forceTemplate);
  },

  /**
   * Full ingest with ACID guarantees:
   *  1. Compute SHA256 hash → block re-upload (file-level idempotency)
   *  2. Parse file with bank-specific parser
   *  3. Inside a single prisma.$transaction (Serializable isolation):
   *     - Create StatementFile record
   *     - createMany transactions (skipDuplicates so race-safe via unique index)
   *     - Recompute bank account balance from posted transactions (deterministic)
   *  4. If ANY step fails, the entire batch is rolled back.
   */
  async ingest(params: IngestParams): Promise<IngestResult> {
    const {
      buffer,
      fileName,
      mimeType,
      bankAccountId,
      companyId,
      uploadedById,
      forceTemplate,
      defaultCategoryId,
      rowCategories,
      excludedRows,
      currency,
      dryRun,
    } = params;

    const hash = computeHash(buffer);

    // Bank account must exist & belong to company
    const account = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId, isActive: true },
    });
    if (!account) throw new BadRequestError('ບັນຊີທະນາຄານບໍ່ພົບ ຫຼື ບໍ່ active');

    // File-level idempotency check (also enforced by unique([bankAccountId, fileHash]))
    const existingFile = await prisma.statementFile.findFirst({
      where: { bankAccountId, fileHash: hash },
    });
    if (existingFile) {
      throw new ConflictError('ໄຟລ໌ນີ້ໄດ້ຖືກນຳເຂົ້າແລ້ວ', {
        statementFileId: existingFile.id,
        importedAt: existingFile.createdAt,
        importedRecords: existingFile.importedRecords,
      });
    }

    // Parse using bank-specific parser
    const parsed = parseStatement(buffer, forceTemplate);
    if (parsed.rows.length === 0) {
      throw new BadRequestError(
        `ບໍ່ສາມາດ parse ຂໍ້ມູນຈາກໄຟລ໌ໄດ້ (template: ${parsed.template}). ${parsed.warnings.join('; ')}`,
      );
    }

    const useCurrency = currency ?? (parsed.currency as Currency);
    const exchange = await prisma.exchangeRate.findFirst({
      where: {
        AND: [
          {
            fromCurrency: useCurrency,
          },
          {
            toCurrency: Currency.LAK,
          },
          // {
          //   effectiveAt: {
          //     lte: new Date(),
          //   },
          // },
        ],
      },
      orderBy: {
        effectiveAt: 'desc',
      },
    }); // single currency per account; multi-currency conversion deferred
    if (!exchange) {
      throw new BadRequestError(`ບໍມີອັດຕາແລກປ່ຽນໃນລະຫວ່າງ ສະກຸນເງິນ${useCurrency} ຫາ ສະກຸນເງິນ LAK`);
    }
    const exchangeRate = exchange.rate;
    // Dedupe within the batch itself (same date+amount+reference can repeat in source file)
    const seen = new Set<string>();
    const txnRecords: Prisma.TransactionCreateManyInput[] = [];
    let duplicateInBatch = 0;

    const filePath = dryRun ? `(dry-run)/${hash}` : await persistFile(buffer, hash, fileName);

    // Generate placeholder StatementFile id so transactions can FK to it
    // We'll create it inside the transaction; but we need its id for the createMany.
    // Solution: precompute id with cuid lib? We don't have one — use Prisma's collect-id pattern:
    // we'll create StatementFile FIRST inside the tx, then use its id.

    // Filter out excluded rows (user deleted them in the preview step)
    const activeRows = excludedRows
      ? parsed.rows.filter((r) => !excludedRows!.has(r.rowNumber))
      : parsed.rows;

    if (dryRun) {
      // Don't touch DB at all; just produce a preview.
      for (const row of activeRows) {
        const key = `${row.transactionDate.toISOString()}|${row.amount}|${row.bankReference ?? ''}`;
        if (seen.has(key)) {
          duplicateInBatch++;
          continue;
        }
        seen.add(key);
      }
      return {
        statementFileId: null,
        template: parsed.template,
        totalRows: activeRows.length,
        created: activeRows.length - duplicateInBatch,
        duplicateInBatch,
        warnings: parsed.warnings,
        preview: activeRows.slice(0, 20).map((r) => ({
          rowNumber: r.rowNumber,
          transactionDate: r.transactionDate.toISOString(),
          description: r.description,
          amount: r.amount,
          type: r.type,
          bankReference: r.bankReference,
        })),
      };
    }

    // Validate category/subcategory IDs before transaction and fetch parent category IDs
    const allSubCategoryIds = new Set<string>();
    if (defaultCategoryId) allSubCategoryIds.add(defaultCategoryId);
    if (rowCategories) {
      Object.values(rowCategories).forEach(id => allSubCategoryIds.add(id));
    }

    // Map to store subcategory ID -> parent category ID
    const subCategoryToCategoryMap = new Map<string, string>();

    if (allSubCategoryIds.size > 0) {
      const existingSubCategories = await prisma.subCategory.findMany({
        where: { id: { in: Array.from(allSubCategoryIds) } },
        select: { id: true, categoryId: true }
      });
      const existingIds = new Set(existingSubCategories.map(sc => sc.id));
      const invalidIds = Array.from(allSubCategoryIds).filter(id => !existingIds.has(id));
      
      if (invalidIds.length > 0) {
        throw new BadRequestError(`Invalid subcategory IDs: ${invalidIds.join(', ')}`);
      }

      // Build mapping of subcategory ID to parent category ID
      existingSubCategories.forEach(sc => {
        subCategoryToCategoryMap.set(sc.id, sc.categoryId);
      });
    }

    // Real write — wrap in a serializable transaction
    const result = await prisma.$transaction(
      async (tx) => {
        const stmt = await tx.statementFile.create({
          data: {
            bankAccountId,
            fileName,
            filePath,
            fileSize: buffer.length,
            mimeType,
            fileHash: hash,
            bankTemplate: parsed.template,
            status: 'PARSED',
            periodStart: parsed.periodStart,
            periodEnd: parsed.periodEnd,
            totalRecords: parsed.rows.length,
            uploadedById,
          },
        });

        for (const row of activeRows) {
          const key = `${row.transactionDate.toISOString()}|${row.amount}|${row.bankReference ?? ''}`;
          if (seen.has(key)) {
            duplicateInBatch++;
            continue;
          }
          seen.add(key);
          const subCategoryId =
            (rowCategories && rowCategories[row.rowNumber]) || defaultCategoryId || null;
          const categoryId = subCategoryId ? subCategoryToCategoryMap.get(subCategoryId) : null;

          const total = new Prisma.Decimal(row.amount).mul(exchangeRate);
          txnRecords.push({
            reference: generateReference(row.type),
            companyId,
            bankAccountId,
            type: row.type,
            status: 'POSTED',
            transactionDate: row.transactionDate,
            amount: row.amount,
            currency: useCurrency,
            exchangeRate,
            exchangeRateId: exchange.id,
            amountInBase: total.toString(),
            categoryId: categoryId || undefined,
            subCategoryId: subCategoryId || undefined,
            description: row.description.slice(0, 1000),
            bankReference: row.bankReference,
            source: 'STATEMENT_IMPORT',
            statementFileId: stmt.id,
            createdById: uploadedById,
            postedAt: new Date(),
          });
        }

        // createMany with skipDuplicates uses the unique index uniq_bank_txn
        // (bankAccountId, bankReference, transactionDate, amount) for atomic dedup against DB.
        const inserted = await tx.transaction.createMany({
          data: txnRecords,
          skipDuplicates: true,
        });

        // Recompute account balance deterministically from POSTED transactions —
        // safer than incremental ± in a multi-row import
        const income = await tx.transaction.aggregate({
          where: { bankAccountId, status: 'POSTED', type: 'INCOME' },
          _sum: { amountInBase: true },
        });
        const expense = await tx.transaction.aggregate({
          where: { bankAccountId, status: 'POSTED', type: 'EXPENSE' },
          _sum: { amountInBase: true },
        });
        const balance =
          Number(account.openingBalance) +
          Number(income._sum.amountInBase ?? 0) -
          Number(expense._sum.amountInBase ?? 0);

        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: { currentBalance: balance },
        });

        await tx.statementFile.update({
          where: { id: stmt.id },
          data: {
            status: 'PROCESSED',
            importedRecords: inserted.count,
            duplicateCount: parsed.rows.length - inserted.count,
          },
        });

        await tx.activityLog.create({
          data: {
            userId: uploadedById,
            action: 'IMPORT_STATEMENT',
            entityType: 'StatementFile',
            entityId: stmt.id,
            newValue: {
              fileName,
              template: parsed.template,
              totalRows: parsed.rows.length,
              imported: inserted.count,
            },
          },
        });

        return {
          statementFileId: stmt.id,
          inserted: inserted.count,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
        maxWait: 10_000,
      },
    );

    return {
      statementFileId: result.statementFileId,
      template: parsed.template,
      totalRows: activeRows.length,
      created: result.inserted,
      duplicateInBatch: activeRows.length - result.inserted,
      warnings: parsed.warnings,
      preview: activeRows.slice(0, 20).map((r) => ({
        rowNumber: r.rowNumber,
        transactionDate: r.transactionDate.toISOString(),
        description: r.description,
        amount: r.amount,
        type: r.type,
        bankReference: r.bankReference,
      })),
    };
  },
};
