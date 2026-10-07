const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// trainer-client-service con sus dependencias en memoria: invitar y aceptar pasan siempre por el
// bloqueo de admisión del entrenador (adapter.withClientAdmission), con o sin Stripe.
function fixture({ capacity = 50, admission = 20, clients = [], occupied = [] } = {}) {
  // Un par por email; los de `clients` ya reservan plaza (invitación pendiente).
  const pairs = new Map(clients.map((email) => [email, { trainerId: 'trainer1', clientEmail: email, scopes: [{ scope: 'training', status: 'pending' }] }]));
  let tail = Promise.resolve();
  const calls = { admissions: 0, inserts: 0, emails: 0, updates: [], seatChecks: [], forms: [] };
  // El cliente responde todas las invitaciones pendientes del par a la vez.
  const answer = (pairId, linkIds, status) => {
    calls.updates.push({ pairId, linkIds, status });
    const pair = [...pairs.values()].find((candidate) => candidate._id === pairId);
    pair.scopes.filter((link) => linkIds.includes(link._id)).forEach((link) => { link.status = status; });
    return pair;
  };
  const dependencies = {
    './trainer-client-dao': {
      async findPairByEmail(_trainerId, email) { return pairs.get(email) || null; },
      async countSeats() { return { occupied: 0, reserved: pairs.size }; },
      async hasOtherActiveTrainer() { return false; },
      async createInvitation(trainerId, clientEmail, scope) {
        await new Promise((resolve) => setImmediate(resolve));
        const pair = pairs.get(clientEmail) || { trainerId, clientEmail, scopes: [] };
        pair.scopes.push({ scope, status: 'pending' });
        pairs.set(clientEmail, pair);
        calls.inserts++;
        return { pair, invitation: { trainerId, clientEmail, scope, status: 'pending' } };
      },
      async setIntakeForm(_trainerId, clientEmail, form) { calls.forms.push({ clientEmail, form }); },
      async acceptInvitations(pairId, linkIds) { return answer(pairId, linkIds, 'active'); },
      async declineInvitations(pairId, linkIds) { return answer(pairId, linkIds, 'declined'); },
    },
    './trainer-seat-service': {
      async assertSeatForAcceptance(trainerId, clientId, seats) {
        calls.seatChecks.push({ trainerId, clientId, seats });
        if (!occupied.includes(clientId) && occupied.length >= seats) {
          throw Object.assign(new Error('Sin plaza libre'), { code: 'SEAT_UNAVAILABLE' });
        }
      },
    },
    './pair-state': require('../trainerClients/pair-state'),
    '../trainerIntakeConfig/trainer-intake-config-service': { async intakeFormFor() { return { enabledFields: ['goals'] }; } },
    '../util/http-error': require('../util/http-error'),
    '../notifications/notification-dao': { async createForTrainer() {} },
    '../users/user-dao': { findFieldsByEmail: async () => null },
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
    '../users/user-time-zone': { todayForUser: async () => '2026-10-02' },
  };
  const file = path.resolve(__dirname, '../trainerClients/trainer-client-service.js');
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: exported, exports: exported.exports,
    require: (name) => dependencies[name] || {},
    process: { env: {} }, console,
  }, { filename: file });
  const trainer = { email: 'trainer@example.test' };
  const invite = (id, email) => pairs.set(email, { _id: `pair-${email}`, trainerId: 'trainer1', clientEmail: email,
    scopes: [{ _id: id, scope: 'training', status: 'pending', invitedAt: new Date() }] });
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

test('la invitación copia al par el formulario de alta; sin plaza no copia nada', async () => {
  const f = fixture({ admission: 1 });
  await f.service.inviteClient('trainer1', f.trainer, 'one@example.test', ['training', 'nutrition']);
  assert.deepEqual(f.calls.forms, [{ clientEmail: 'one@example.test', form: { enabledFields: ['goals'] } }], 'una copia por invitación, no por scope');
  await assert.rejects(f.service.inviteClient('trainer1', f.trainer, 'two@example.test', ['training']), { code: 'TRAINER_LIMIT_REACHED' });
  assert.equal(f.calls.forms.length, 1);
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
  const accepted = await f.service.respondToInvites('trainer1', client('c3', 'new@x.test'), 'accept');
  // Spread: el array viene del contexto vm (otro realm) y deepEqual compara prototipos.
  assert.deepEqual([...accepted.scopes], ['training']);
  assert.equal(f.calls.admissions, 1);
  assert.deepEqual(f.calls.seatChecks, [{ trainerId: 'trainer1', clientId: 'c3', seats: 25 }],
    'una reserva ya hecha se respeta aunque haya una bajada programada');
});

test('si el entrenador se quedó sin plazas, la invitación no se cancela: no se puede aceptar hasta que haya sitio', async () => {
  const f = fixture({ capacity: 2, occupied: ['c1', 'c2'] });
  f.invite('inv1', 'late@x.test');
  await assert.rejects(f.service.respondToInvites('trainer1', client('c9', 'late@x.test'), 'accept'), { code: 'SEAT_UNAVAILABLE' });
  assert.deepEqual(f.calls.updates, []);
  // Rechazar sí es posible siempre y no pasa por las plazas.
  await f.service.respondToInvites('trainer1', client('c9', 'late@x.test'), 'decline');
  assert.deepEqual(f.calls.updates.map((entry) => entry.status), ['declined']);
  assert.equal(f.calls.admissions, 1);
});

test('quien ya ocupa plaza con un scope puede aceptar el otro sin plaza libre', async () => {
  const f = fixture({ capacity: 2, occupied: ['c1', 'c2'] });
  f.invite('inv2', 'c1@x.test');
  assert.deepEqual([...(await f.service.respondToInvites('trainer1', client('c1', 'c1@x.test'), 'accept')).scopes], ['training']);
});
