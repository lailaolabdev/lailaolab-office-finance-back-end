import { PrismaClient, UserRole, AccountType, Currency } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Banks
  const banks = [
    { code: 'BCEL', name: 'ທະນາຄານການຄ້າຕ່າງປະເທດລາວ', nameEn: 'BCELOne (BCEL)' },
    { code: 'JDB', name: 'ທະນາຄານຮ່ວມພັດທະນາ', nameEn: 'Joint Development Bank (JDB)' },
    { code: 'LDB', name: 'ທະນາຄານພັດທະນາລາວ', nameEn: 'Lao Development Bank (LDB)' },
    { code: 'IB', name: 'ທະນາຄານອຸດສາຫະກຳ', nameEn: 'Industrial Bank (IB)' },
    { code: 'ACELIDA', name: 'ທະນາຄານ ACELIDA', nameEn: 'ACELIDA Bank (ACELIDA)' },
  ];

  for (const bank of banks) {
    await prisma.bank.upsert({
      where: { code: bank.code },
      update: {},
      create: bank,
    });
  }
  console.log(`✅ Seeded ${banks.length} banks`);

  // Admin user
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@lailaolab.com' },
    update: {},
    create: {
      email: 'admin@lailaolab.com',
      password: passwordHash,
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
    },
  });
  console.log('✅ Created admin user: admin@lailaolab.com / admin123');

  // Sample income categories
  const incomeCategories = [
    { code: 'INC-002', name: 'ລາຍຣັບ', },
    // { code: 'INC-003', name: 'ດອກເບັ້ຍ', },
    // { code: 'INC-099', name: 'ລາຍຮັບອື່ນໆ', },
  ];

  // Sample expense categories
  const expenseCategories = [

    { code: 'EXP-001', name: 'ລາຍຈ່າຍ', },
    // { code: 'EXP-001', name: 'ເງິນເດືອນ', },
    // { code: 'EXP-002', name: 'ຄ່ານ້ຳ-ໄຟ', },
    // { code: 'EXP-003', name: 'ຄ່າເຊົ່າ', },
    // { code: 'EXP-004', name: 'ການຕະຫຼາດ', },
    // { code: 'EXP-005', name: 'ຄ່າຂົນສົ່ງ', },
    // { code: 'EXP-006', name: 'ອຸປະກອນສຳນັກງານ', },
    // { code: 'EXP-099', name: 'ລາຍຈ່າຍອື່ນໆ' },
  ];

  for (const cat of [...incomeCategories, ...expenseCategories]) {
    await prisma.category.upsert({
      where: { code: cat.code },
      update: {},
      create: cat,
    });
  }
  console.log(`✅ Seeded ${incomeCategories.length + expenseCategories.length} categories`);

  // Sample sub-categories
  const goods = await prisma.category.findUnique({ where: { code: 'INC-001' } });
  const services = await prisma.category.findUnique({ where: { code: 'INC-002' } });
  const salary = await prisma.category.findUnique({ where: { code: 'EXP-001' } });
  const marketing = await prisma.category.findUnique({ where: { code: 'EXP-004' } });

  const subCategories = [
    ...(goods
      ? [
        { code: 'INC-001-01', name: 'ຂາຍສິນຄ້າຮ້ານ', categoryId: goods.id },
        { code: 'INC-001-02', name: 'ຂາຍສິນຄ້າອອນລາຍ', categoryId: goods.id },
      ]
      : []),
    ...(services
      ? [
        { code: 'INC-002-01', name: 'ບໍລິການລາຍເດືອນ', categoryId: services.id },
        { code: 'INC-002-02', name: 'ບໍລິການຄັ້ງດຽວ', categoryId: services.id },
      ]
      : []),
    ...(salary
      ? [
        { code: 'EXP-001-01', name: 'ເງິນເດືອນພະນັກງານ', categoryId: salary.id },
        { code: 'EXP-001-02', name: 'ໂບນັດ', categoryId: salary.id },
      ]
      : []),
    ...(marketing
      ? [
        { code: 'EXP-004-01', name: 'ໂຄສະນາ Facebook', categoryId: marketing.id },
        { code: 'EXP-004-02', name: 'ໂຄສະນາ Google', categoryId: marketing.id },
      ]
      : []),
  ];

  for (const sub of subCategories) {
    await prisma.subCategory.upsert({
      where: { code: sub.code },
      update: {},
      create: sub,
    });
  }
  console.log(`✅ Seeded ${subCategories.length} sub-categories`);

  // Sample companies (matching real LailaoLab + sample data)
  const companies = [
    { code: 'C001', name: 'ບໍລິສັດ ລາຍລາວແລັບ ໄອຊີທີ ໂຊລູເຊິນ ຈຳກັດ', nameEn: 'LAILAOLAB ICT SOLUTIONS' },
    { code: 'C002', name: 'PHAPAY CO., LTD', nameEn: 'PhaPay Co., Ltd' },
    { code: 'C003', name: 'ບໍລິສັດ C', nameEn: 'Company C' },
    { code: 'C004', name: 'ບໍລິສັດ D', nameEn: 'Company D' },
    { code: 'C005', name: 'ບໍລິສັດ E', nameEn: 'Company E' },
    { code: 'C006', name: 'ບໍລິສັດ F', nameEn: 'Company F' },
  ];

  for (const company of companies) {
    await prisma.company.upsert({
      where: { code: company.code },
      update: {},
      create: company,
    });
  }
  console.log(`✅ Seeded ${companies.length} sample companies`);

  // Sample bank accounts that match the doc/*.xlsx samples so importing them works out-of-the-box
  const bcel = await prisma.bank.findUnique({ where: { code: 'BCEL' } });
  const jdb = await prisma.bank.findUnique({ where: { code: 'JDB' } });
  const ldb = await prisma.bank.findUnique({ where: { code: 'LDB' } });
  const ib = await prisma.bank.findUnique({ where: { code: 'IB' } });
  const c1 = await prisma.company.findUnique({ where: { code: 'C001' } });
  const c2 = await prisma.company.findUnique({ where: { code: 'C002' } });

  if (bcel && jdb && ldb && ib && c1 && c2) {
    const accounts = [
      {
        companyId: c1.id,
        bankId: bcel.id,
        accountNumber: '010110001954452001',
        accountName: 'LAILAOLAB ICT SOLUTIONS',
        accountType: AccountType.USABLE,
        currency: Currency.LAK,
      },
      {
        companyId: c1.id,
        bankId: jdb.id,
        accountNumber: '0980120000000006170001',
        accountName: 'LAILAOLAB ICT SOLUTIONS',
        accountType: AccountType.USABLE,
        currency: Currency.LAK,
      },
      {
        companyId: c1.id,
        bankId: ib.id,
        accountNumber: '0100001633295',
        accountName: 'LAILAOLAB ICT SOLUTIONS',
        accountType: AccountType.USABLE,
        currency: Currency.LAK,
      },
      {
        companyId: c2.id,
        bankId: ldb.id,
        accountNumber: '0302000010006190',
        accountName: 'PHAPAY CO., LTD',
        accountType: AccountType.USABLE,
        currency: Currency.LAK,
      },
    ];

    for (const acc of accounts) {
      await prisma.bankAccount.upsert({
        where: {
          companyId_bankId_accountNumber: {
            companyId: acc.companyId,
            bankId: acc.bankId,
            accountNumber: acc.accountNumber,
          },
        },
        update: {},
        create: acc,
      });
    }
    console.log(`✅ Seeded ${accounts.length} sample bank accounts (matching doc samples)`);
  }

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
