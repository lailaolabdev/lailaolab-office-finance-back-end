import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run tests against the real database.');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
}
if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 16) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret';
}

process.env.NODE_ENV = 'test';
