# Backend — Finance & Accounting System

Express.js + TypeScript + Prisma + PostgreSQL

## Structure

```
backend/
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Seed data
├── src/
│   ├── config/             # env, prisma config
│   ├── controllers/        # Request handlers
│   ├── middleware/         # auth, validation, error
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── utils/              # Helpers (jwt, logger, errors)
│   ├── types/              # TypeScript types
│   ├── app.ts              # Express app
│   └── server.ts           # Server entry
├── .env.example
├── package.json
└── tsconfig.json
```

## Setup

```bash
# 1. Copy env file
cp .env.example .env

# 2. Install
npm install

# 3. Generate Prisma client
npm run db:generate

# 4. Run migrations
npm run db:migrate

# 5. Seed sample data
npm run db:seed

# 6. Start dev server
npm run dev
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run db:migrate` | Create/apply migration |
| `npm run db:seed` | Seed sample data |
| `npm run db:studio` | Open Prisma Studio (DB GUI) |
| `npm run db:reset` | Drop & recreate database |

## API Endpoints

Base URL: `http://localhost:4000/api/v1`

### Auth
- `POST /auth/login` — Login
- `POST /auth/register` — Register
- `POST /auth/refresh` — Refresh token
- `GET /auth/me` — Current user

### Companies
- `GET /companies`
- `POST /companies`
- `GET /companies/:id`
- `PATCH /companies/:id`
- `DELETE /companies/:id`

### Bank Accounts
- `GET /bank-accounts`
- `POST /bank-accounts`
- `GET /bank-accounts/:id`
- `PATCH /bank-accounts/:id`

### Banks (read-only master data)
- `GET /banks`

### Categories
- `GET /categories?type=INCOME|EXPENSE`
- `POST /categories`
- `PATCH /categories/:id`

### Transactions
- `GET /transactions` — List with filters & pagination
- `GET /transactions/daily-summary?date=YYYY-MM-DD`
- `GET /transactions/:id`
- `POST /transactions` — Create (with duplicate detection)
- `POST /transactions/:id/void` — Void transaction

### Dashboard
- `GET /dashboard/summary` — KPI summary
- `GET /dashboard/cash-position` — Cash by account type

## Default Admin

After seeding:
- Email: `admin@lailaolab.com`
- Password: `admin123`
