import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { getAdminAccessToken, cleanupTestRecords, TEST_PREFIX } from './helpers';

const API = '/api/v1';

describe('Express app — error & route coverage', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminAccessToken();
  });

  afterAll(async () => {
    await cleanupTestRecords();
    await prisma.$disconnect();
  });

  describe('Health & 404', () => {
    it('GET /api/v1/health → 200', async () => {
      const res = await request(app).get(`${API}/health`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('unknown route → 404 NOT_FOUND', async () => {
      const res = await request(app).get('/no-such-route');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Auth', () => {
    it('POST /auth/login with bad email → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'not-an-email', password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /auth/login with wrong credentials → 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'admin@lailaolab.com', password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /auth/login with correct admin credentials → 200 + tokens', async () => {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'admin@lailaolab.com', password: 'admin123' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
      expect(res.body.data.user.role).toBe('ADMIN');
    });

    it('POST /auth/refresh with bad token → 401', async () => {
      const res = await request(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: 'not-a-real-token' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /auth/me without token → 401', async () => {
      const res = await request(app).get(`${API}/auth/me`);
      expect(res.status).toBe(401);
    });

    it('GET /auth/me with token → 200', async () => {
      const res = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('admin@lailaolab.com');
    });
  });

  describe('Authorization gates', () => {
    it('protected route without token → 401', async () => {
      const res = await request(app).get(`${API}/companies`);
      expect(res.status).toBe(401);
    });

    it('protected route with malformed Authorization → 401', async () => {
      const res = await request(app)
        .get(`${API}/companies`)
        .set('Authorization', 'NotBearer abc');
      expect(res.status).toBe(401);
    });
  });

  describe('Banks (read-only seeded list)', () => {
    it('GET /banks returns seeded banks', async () => {
      const res = await request(app)
        .get(`${API}/banks`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const codes = (res.body.data as Array<{ code: string }>).map((b) => b.code);
      expect(codes).toEqual(expect.arrayContaining(['BCEL', 'JDB', 'LDB', 'IB', 'ACELIDA']));
    });
  });

  describe('Companies CRUD + validation', () => {
    const companyCode = `${TEST_PREFIX}CO1`;
    let companyId: string;

    it('POST /companies without auth → 401', async () => {
      const res = await request(app).post(`${API}/companies`).send({ code: companyCode, name: 'X' });
      expect(res.status).toBe(401);
    });

    it('POST /companies with invalid body → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`${API}/companies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: '', name: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /companies creates company → 201', async () => {
      const res = await request(app)
        .post(`${API}/companies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: companyCode, name: 'Test Company' });
      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe(companyCode);
      companyId = res.body.data.id;
    });

    it('POST /companies with duplicate code → 409 CONFLICT', async () => {
      const res = await request(app)
        .post(`${API}/companies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: companyCode, name: 'Dup' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('GET /companies/:id with non-existent id → 404 NOT_FOUND', async () => {
      const res = await request(app)
        .get(`${API}/companies/nope-not-a-real-id`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('GET /companies/:id returns the created company', async () => {
      const res = await request(app)
        .get(`${API}/companies/${companyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(companyId);
    });

    it('PATCH /companies/:id updates name', async () => {
      const res = await request(app)
        .patch(`${API}/companies/${companyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed Co' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed Co');
    });

    it('DELETE /companies/:id soft-deletes (isActive=false)', async () => {
      const res = await request(app)
        .delete(`${API}/companies/${companyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const fresh = await prisma.company.findUnique({ where: { id: companyId } });
      expect(fresh?.isActive).toBe(false);
    });
  });

  describe('Dashboard', () => {
    it('GET /dashboard/summary returns totals', async () => {
      const res = await request(app)
        .get(`${API}/dashboard/summary`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('companies');
      expect(res.body.data).toHaveProperty('accounts');
      expect(res.body.data).toHaveProperty('txnsToday');
      expect(res.body.data).toHaveProperty('usableBalance');
    });

    it('GET /dashboard/cash-position returns grouped data', async () => {
      const res = await request(app)
        .get(`${API}/dashboard/cash-position`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('Categories', () => {
    it('GET /categories returns active categories', async () => {
      const res = await request(app)
        .get(`${API}/categories`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('GET /categories?type=INCOME filters by type', async () => {
      const res = await request(app)
        .get(`${API}/categories?type=INCOME`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      for (const cat of res.body.data as Array<{ type: string }>) {
        expect(cat.type).toBe('INCOME');
      }
    });
  });

  describe('Transactions', () => {
    it('GET /transactions/daily-summary returns shape', async () => {
      const res = await request(app)
        .get(`${API}/transactions/daily-summary`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('totalIncome');
      expect(res.body.data).toHaveProperty('totalExpense');
      expect(res.body.data).toHaveProperty('net');
    });

    it('POST /transactions with invalid body → 400', async () => {
      const res = await request(app)
        .post(`${API}/transactions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -10 }); // many required fields missing
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH /transactions/:id with invalid body → 400', async () => {
      const res = await request(app)
        .patch(`${API}/transactions/some-id`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH /transactions/:id without auth → 401', async () => {
      const res = await request(app).patch(`${API}/transactions/some-id`).send({ amount: 10 });
      expect(res.status).toBe(401);
    });
  });
});
