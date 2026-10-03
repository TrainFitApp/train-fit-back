const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// trainer-client-service con sus dependencias en memoria: invitar y aceptar pasan siempre por el
// bloqueo de admisión del entrenador (adapter.withClientAdmission), con o sin Stripe.
function fixture({ capacity = 50, admission = 20, clients = [], occupied = [] } = {}) {
  const clientKeys = new Set(clients.map((email) => `email:${email}`));
  let tail = Promise.resolve();
  const calls = { admissions: 0, inserts: 0, emails: 0, updates: [], seatChecks: [] };
  const invitations = new Map();
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
      async findById(id) { return invitations.get(id) || null; },
      async findByTrainerAndClientInStatuses() { return []; },
      async updateStatus(id, status, extra) { calls.updates.push({ id, status, extra }); return { ...invitations.get(id), status, ...extra }; },
    },
    './trainer-seat-service': {
      async assertSeatForAcceptance(trainerId, clientId, seats) {
        calls.seatChecks.push({ trainerId, clientId, seats });
        if (!occupied.includes(clientId) && occupied.length >= seats) {
          throw Object.assign(new Error('Sin plaza libre'), { code: 'SEAT_UNAVAILABLE' });
        }
      },
    },
    './intake-pending': { intakePendingOnAccept: () => true, intakeStatusFor: () => null },
    '../notifications/notification-dao': { async createForTrainer() {} },
    '../users/schema': { findOne: () => ({ lean: async () => null }) },
    '../trainerBilling/adapter': {
      async withClientAdmission(userId, action) {
        assert.equal(userId, 'trainer1');
        calls.admissions++;
        const previous = tail;
        let release;
        tail = new Promise((resolve) => { release = resolve; });
        await previous;
        try { return await action(admission, capacity); }
        finally { release(); }
      },
    },
    '../util/mail': { generateMail: () => '', async sendTransactionalMail() { calls.emails++; } },
    '../util/date-util': { todayIsoDate: () => '2026-10-02' },
  };
  const file = path.resolve(__dirname, '../trainerClients/trainer-client-service.js');
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: exported, exports: exported.exports,
    require: (name) => dependencies[name] || {},
    process: { env: {} }, console,
  }, { filename: file });
  const trainer = { email: 'trainer@example.test' };
  const invite = (id, email) => invitations.set(id, { _id: id, trainerId: 'trainer1', clientEmail: email, scope: 'training', status: 'pending' });
  return { service: exported.exports, trainer, calls, invite };
}
const client = (id, email) => ({ _id: id, email });

test('una bajada programada limita las altas nuevas aunque el plan actual aún tenga plazas', async () => {
  const f = fixture({ admission: 2, clients: ['one@example.test', 'two@example.test'] });
  await assert.rejects(f.service.inviteClient('trainer1', f.trainer, 'three@example.test', ['training']), { code: 'TRAINER_LIMIT_REACHED' });
  assert.equal(f.calls.admissions, 1);
  assert.equal(f.calls.inserts, 0);
  assert.equal(f.calls.emails, 0, 'invitar nunca compra plazas ni avisa sin plaza');
});

test('dos invitaciones a la vez no pueden ocupar la última plaza', async () => {
  const f = fixture({ admission: 1 });
  const outcomes = await Promise.allSettled([
    f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['training']),
    f.service.inviteClient('trainer1', f.trainer, 'two@example.test', ['training']),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((result) => result.status === 'rejected').reason.code, 'TRAINER_LIMIT_REACHED');
  assert.equal(f.calls.inserts, 1);
  assert.equal(f.calls.emails, 1);
});

test('invitar a la otra parte de un cliente ya contado no ocupa otra plaza', async () => {
  const f = fixture({ admission: 1, clients: ['one@example.test'] });
  const results = await f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['nutrition']);
  assert.equal(results[0].success, true);
  assert.equal(f.calls.inserts, 1);
});

test('Free sin Stripe también invita bajo el bloqueo, con sus plazas gratis', async () => {
  const f = fixture({ capacity: 3, admission: 3, clients: ['a@x.test', 'b@x.test'] });
  assert.equal((await f.service.inviteClient('trainer1', f.trainer, 'c@x.test', ['training']))[0].success, true);
  await assert.rejects(f.service.inviteClient('trainer1', f.trainer, 'd@x.test', ['training']), { code: 'TRAINER_LIMIT_REACHED' });
  assert.equal(f.calls.admissions, 2);
});

test('aceptar una invitación ocupa la plaza reservada bajo el bloqueo, contra las plazas contratadas hoy', async () => {
  const f = fixture({ capacity: 25, admission: 22, occupied: ['c1', 'c2'] });
  f.invite('inv1', 'new@x.test');
  const accepted = await f.service.respondToInvite('inv1', client('c3', 'new@x.test'), 'accept');
  assert.equal(accepted.status, 'active');
  assert.equal(f.calls.admissions, 1);
  assert.deepEqual(f.calls.seatChecks, [{ trainerId: 'trainer1', clientId: 'c3', seats: 25 }],
    'una reserva ya hecha se respeta aunque haya una bajada programada');
});

test('si el entrenador se quedó sin plazas, la invitación no se cancela: no se puede aceptar hasta que haya sitio', async () => {
  const f = fixture({ capacity: 2, occupied: ['c1', 'c2'] });
  f.invite('inv1', 'late@x.test');
  await assert.rejects(f.service.respondToInvite('inv1', client('c9', 'late@x.test'), 'accept'), { code: 'SEAT_UNAVAILABLE' });
  assert.deepEqual(f.calls.updates, []);
  // Rechazar sí es posible siempre y no pasa por las plazas.
  await f.service.respondToInvite('inv1', client('c9', 'late@x.test'), 'decline');
  assert.deepEqual(f.calls.updates.map((entry) => entry.status), ['declined']);
  assert.equal(f.calls.admissions, 1);
});

test('quien ya ocupa plaza con un scope puede aceptar el otro sin plaza libre', async () => {
  const f = fixture({ capacity: 2, occupied: ['c1', 'c2'] });
  f.invite('inv2', 'c1@x.test');
  assert.equal((await f.service.respondToInvite('inv2', client('c1', 'c1@x.test'), 'accept')).status, 'active');
});
