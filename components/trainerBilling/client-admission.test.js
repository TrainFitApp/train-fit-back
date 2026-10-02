const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ currentLimit = 50, admissionLimit = 20, clients = [], enabled = true } = {}) {
  const clientKeys = new Set(clients.map((email) => `email:${email}`));
  let tail = Promise.resolve();
  const calls = { admissions: 0, inserts: 0, emails: 0, locked: false };
  const dependencies = {
    './trainer-client-dao': {
      async getBillableClientKeys() { return new Set(clientKeys); },
      async findOverlapping() { return null; },
      async create(input) {
        await new Promise((resolve) => setImmediate(resolve));
        clientKeys.add(`email:${input.clientEmail}`);
        calls.inserts++;
        return { ...input };
      },
    },
    '../users/schema': { findOne: () => ({ lean: async () => null }) },
    '../billing/feature-access-service': { getTrainerLimits: () => ({ clients: currentLimit }) },
    '../trainerBilling/adapter': {
      async withClientAdmission(userId, action) {
        assert.equal(userId, 'trainer1');
        calls.admissions++;
        const previous = tail;
        let release;
        tail = new Promise((resolve) => { release = resolve; });
        await previous;
        calls.locked = true;
        try { return await action(admissionLimit); }
        finally { calls.locked = false; release(); }
      },
    },
    '../util/mail': {
      generateMail: () => '',
      async sendTransactionalMail() { calls.emails++; },
    },
    '../util/date-util': { todayIsoDate: () => '2026-09-18' },
  };
  const file = path.resolve(__dirname, '../trainerClients/trainer-client-service.js');
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: exported, exports: exported.exports,
    require: (name) => dependencies[name] || {},
    process: { env: { TRAINER_BILLING_ENABLED: enabled ? '1' : '0' } }, console,
  }, { filename: file });
  const trainer = { email: 'trainer@example.test', professionalPremium: { source: 'stripe' } };
  return { service: exported.exports, trainer, calls };
}

test('scheduled lower quota blocks new clients while the current paid plan still has capacity', async () => {
  const f = fixture({ admissionLimit: 2, clients: ['one@example.test', 'two@example.test'] });
  await assert.rejects(f.service.inviteClient('trainer1', f.trainer, 'three@example.test', ['training']), { code: 'TRAINER_LIMIT_REACHED' });
  assert.equal(f.calls.admissions, 1);
  assert.equal(f.calls.inserts, 0);
  assert.equal(f.calls.emails, 0);
});

test('concurrent Stripe invitations cannot both consume the final slot', async () => {
  const f = fixture({ admissionLimit: 1 });
  const outcomes = await Promise.allSettled([
    f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['training']),
    f.service.inviteClient('trainer1', f.trainer, 'two@example.test', ['training']),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'TRAINER_LIMIT_REACHED');
  assert.equal(f.calls.inserts, 1);
  assert.equal(f.calls.emails, 1);
});

test('adding the other scope for a counted client does not consume another slot', async () => {
  const f = fixture({ admissionLimit: 1, clients: ['one@example.test'] });
  const results = await f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['nutrition']);
  assert.equal(results[0].success, true);
  assert.equal(f.calls.inserts, 1);
});

test('legacy trainers retain their existing quota path without loading Stripe', async () => {
  const f = fixture({ currentLimit: 3, admissionLimit: 0 });
  f.trainer.professionalPremium.source = 'revenuecat';
  const results = await f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['training']);
  assert.equal(results[0].success, true);
  assert.equal(f.calls.admissions, 0);
});

test('disabled sandbox keeps the existing invitation flow', async () => {
  const f = fixture({ enabled: false, currentLimit: 3, admissionLimit: 0 });
  await f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['training']);
  assert.equal(f.calls.admissions, 0);
});
