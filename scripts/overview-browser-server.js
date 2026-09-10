/*
 * Servidor desechable para navegador: node scripts/overview-browser-server.js
 * Usa app.js y todas sus rutas reales, sin bin/www, .env, crons ni correo.
 * Cierre: POST manifest.shutdown.url con Authorization: Bearer <token>,
 * o escribir "shutdown" en stdin. La base local se elimina al cerrar.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');

async function main() {
  // No heredar credenciales/configuración de producción del proceso llamante.
  const systemKeys = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
  for (const key of Object.keys(process.env)) if (!systemKeys.has(key.toUpperCase())) delete process.env[key];
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  Object.assign(process.env, {
    NODE_ENV: 'test', CORS_OPEN: '1', COOKIE_SECURE: 'false', COOKIE_SAMESITE: 'lax',
    PUBLIC_KEY: keys.publicKey, PRIVATE_KEY: keys.privateKey,
    JWT_ISSUER: `trainfit-overview-browser-${process.pid}`,
    JWT_ALLOWED_AUDIENCES: 'trainfit-front,train-fit-management,trainfit-trainers',
  });

  const database = `trainfit_overview_browser_${process.pid}_${Date.now()}`;
  const uri = `mongodb://127.0.0.1:27017/${database}`;
  const manifestPath = path.resolve(__dirname, '../.tmp/overview-browser-session.json');
  const shutdownToken = crypto.randomBytes(32).toString('hex');
  const requests = [];
  const mongoose = require('mongoose');
  let server;
  let input;
  let manifest;
  let closing;

  function writeManifest() {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  }

  async function shutdown(reason) {
    if (closing) return closing;
    closing = (async () => {
      input?.close();
      process.stdin.pause();
      if (server?.listening) {
        const stopped = new Promise(resolve => server.close(resolve));
        server.closeAllConnections?.();
        await stopped;
      }
      let dropped = false;
      if (mongoose.connection.readyState === 1) {
        if (mongoose.connection.host !== '127.0.0.1' || Number(mongoose.connection.port) !== 27017
          || mongoose.connection.name !== database || !/^trainfit_overview_browser_\d+_\d+$/.test(database)) {
          throw new Error('Cierre bloqueado: la conexión no pertenece a esta base de pruebas local.');
        }
        await mongoose.connection.dropDatabase();
        dropped = true;
      }
      await mongoose.disconnect();
      if (manifest && fs.existsSync(manifestPath)) {
        const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (current.pid === process.pid) {
          manifest = { ...manifest, status: 'closed', closedAt: new Date().toISOString(), reason, databaseDropped: dropped, requests };
          delete manifest.accounts;
          delete manifest.shutdown;
          writeManifest();
        }
      }
      console.log(`[overview-browser] cerrado; base local eliminada: ${dropped}`);
    })();
    return closing;
  }

  // mail.js verifica SMTP al importarse. Se aísla sólo ese transporte: nunca entrega correo.
  const nodemailer = require('nodemailer');
  const createTransport = nodemailer.createTransport.bind(nodemailer);
  nodemailer.createTransport = () => {
    const transport = createTransport({ jsonTransport: true });
    transport.verify = async () => false;
    transport.sendMail = async () => { throw new Error('Correo deshabilitado en overview-browser-server'); };
    return transport;
  };
  // Evita escribir en file.log compartido; mantiene un registro local sin cuerpos ni tokens.
  const loggerPath = require.resolve('../middleware/logger');
  require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports(req, res, next) {
    res.once('finish', () => requests.push({ method: req.method, path: req.path, status: res.statusCode }));
    next();
  } };

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const app = require('../app');
    const User = require('../components/users/schema');
    const Relation = require('../components/trainerClients/trainer-client-schema');
    const Config = require('../components/trainerIntakeConfig/trainer-intake-config-schema');
    const Goal = require('../components/nutritionalGoals/nutritional-goal-schema');
    const Task = require('../components/coachTasks/coach-task-schema');
    const Note = require('../components/trainerNotes/trainer-note-schema');
    const { CoachingStage } = require('../components/clientOverview/overview-schema');
    const { prepareIntake, persistPreparedIntake } = require('../components/clientOverview/intake-service');
    const { upsertMeasurement } = require('../components/clientOverview/measurement-write');
    const { setTimeZone } = require('../components/clientOverview/measurement-profile');
    const { civilToday, weekStart, addDays } = require('../components/clientOverview/body-metrics');
    const overviewService = require('../components/clientOverview/overview-service');
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));

    const timeZone = 'Europe/Madrid';
    const today = civilToday(timeZone);
    const monday = weekStart(today);
    const startDate = addDays(monday, -49);
    const password = 'TrainFit-Overview-Local-2026!';
    const expiresAt = new Date(Date.now() + 365 * 86400000);
    const trainer = await User.create({
      email: 'trainer@overview.invalid', password, name: 'Elena', lastname: 'Prueba local', roles: ['trainer'],
      status: 'active', theme: 'dark',
      professionalPremium: { entitled: true, tier: 'trainer_unlimited', plan: 'local-test', source: 'local-test', expiresAt },
    });
    const clientValues = {
      password, roles: ['user'], status: 'active', theme: 'dark', weight: 78.4, height: 170,
      birth: new Date('1992-04-12T12:00:00Z'), sex: 0, activity: 1, objetive: 1, training: 3,
      premium: { entitled: true, plan: 'local-test', source: 'local-test', expiresAt },
    };
    const client = await User.create({ ...clientValues, email: 'client@overview.invalid', name: 'Lucía', lastname: 'Cliente de prueba' });
    const onboardingClient = await User.create({ ...clientValues, email: 'intake@overview.invalid', name: 'Alex', lastname: 'Intake pendiente' });
    for (const user of [client, onboardingClient]) {
      const goal = await Goal.create({ userId: user._id, name: 'Objetivo de prueba', kcalTotal: 2200, proteinsGTotal: 130, carbohydratesGTotal: 260, fatGTotal: 71 });
      await User.updateOne({ _id: user._id }, { $set: { goalInUse: goal._id } });
      await setTimeZone(user._id, timeZone);
    }
    const questionId = new mongoose.Types.ObjectId();
    await Config.create({
      trainerId: trainer._id, lastScopes: ['training', 'nutrition'], measurementFields: ['weight', 'waist', 'hip'],
      customQuestions: [{ _id: questionId, label: '¿Qué te ayudaría a mantener la constancia?', enabled: true }],
    });
    for (const scope of ['training', 'nutrition']) {
      await Relation.create({ trainerId: trainer._id, clientId: client._id, clientEmail: client.email,
        scope, status: 'cuestionario_pendiente', invitedAt: new Date(`${startDate}T08:00:00Z`), respondedAt: new Date(`${startDate}T09:00:00Z`) });
    }
    const intake = {
      goals: 'Quiero ganar fuerza y mantener una rutina que pueda adaptar a mi horario. Me interesa aprender a regular el esfuerzo y volver a disfrutar de las caminatas largas los fines de semana. Prefiero avanzar con pasos sostenibles, sin centrar todas las decisiones en el peso. Durante las semanas de trabajo intenso necesito alternativas cortas que me ayuden a conservar la constancia.',
      healthConditions: 'Sin lesiones declaradas al iniciar el acompañamiento.', experienceLevel: 'intermediate',
      availability: 'Lunes y miércoles al salir del trabajo; sábado por la mañana.', trainingLocation: 'gym', equipmentTags: ['dumbbells', 'barbell', 'machines'],
      customAnswers: [{ questionId: String(questionId), label: '¿Qué te ayudaría a mantener la constancia?', value: 'Tener una alternativa de 30 minutos para semanas con turnos.' }],
      allergies: 'Sin alergias alimentarias declaradas.', favoriteFoods: 'Legumbres, fruta y platos caseros.', dislikedFoods: 'Ninguno en particular.', cooksAtHome: 'yes',
      measurements: [{ field: 'weight', value: 80.2, date: startDate }, { field: 'waist', value: 88, date: startDate }],
      requestId: 'browser_seed_intake_0001', missingMeasurementsAcknowledged: true, timeZone,
    };
    await persistPreparedIntake(trainer._id, client._id, await prepareIntake(trainer._id, client._id, intake));
    await Relation.updateMany({ trainerId: trainer._id, clientId: client._id }, { $set: { status: 'active', activatedAt: new Date(`${startDate}T10:00:00Z`) } });
    const stage = await CoachingStage.findOne({ trainerId: trainer._id, clientId: client._id }).lean();
    await overviewService.updateContext(trainer._id, client._id, { stageId: stage._id, expectedVersion: stage.version,
      patch: { healthConditions: 'Ha comunicado molestias leves de rodilla al bajar escaleras. Preguntar cómo responde a los cambios de carga antes de progresar.', availability: 'Dos sesiones de 45 minutos y una sesión corta según los turnos.' } });
    // Una semana completa sin pesajes; no se crean puntos artificiales para rellenarla.
    const offsets = [-47, -42, -39, -35, -31, -21, -19, -14, -11, -7, -5, -3];
    for (const [index, offset] of offsets.entries()) {
      await upsertMeasurement({ clientId: client._id, date: addDays(monday, offset),
        fields: { weight: Number((80.1 - index * 0.14 + (index % 2) * 0.12).toFixed(2)) },
        requestId: `browser_seed_weight_${String(index).padStart(3, '0')}`, source: 'client' });
    }
    await upsertMeasurement({ clientId: client._id, date: today, fields: { weight: 78.4, waist: 85.5, hip: 99 }, requestId: 'browser_seed_current_0001', source: 'client' });
    const task = await Task.create({ trainerId: trainer._id, clientId: client._id, stageId: stage._id,
      title: 'Comprobar tolerancia de rodilla antes de progresar', notes: 'Revisar con el cliente qué movimiento resulta cómodo.', dueDate: addDays(today, -1), requestId: 'browser_seed_task_0001' });
    await Note.create({ trainerId: trainer._id, clientId: client._id, stageId: stage._id, pinned: true,
      text: 'Priorizar una alternativa breve en las semanas con turnos. Preguntar por la rodilla antes de aumentar la carga. Esta nota pertenece al profesional de prueba y no aparece en la app del cliente.', requestId: 'browser_seed_note_0001' });
    const overview = await overviewService.getOverview(trainer._id, client._id);
    await overviewService.createReview(trainer._id, client._id, { stageId: stage._id, requestId: 'browser_seed_review_0001',
      conclusion: 'Mantener la estructura actual y adaptar los ejercicios que generen molestias.', nextStep: 'Comprobar la tolerancia a la siguiente sesión.',
      linkedTaskId: task._id, observedFingerprint: overview.review.observedFingerprint, observedAt: overview.review.observedAt });
    await Relation.create({ trainerId: trainer._id, clientId: onboardingClient._id, clientEmail: onboardingClient.email,
      scope: 'training', status: 'cuestionario_pendiente', invitedAt: new Date(), respondedAt: new Date() });
    await upsertMeasurement({ clientId: onboardingClient._id, date: addDays(today, -4), fields: { weight: 78.4 }, requestId: 'browser_seed_pending_0001', source: 'client' });

    server = http.createServer((req, res) => {
      if (req.url === '/__overview_test/shutdown') {
        const provided = Buffer.from(String(req.headers.authorization || ''));
        const expected = Buffer.from(`Bearer ${shutdownToken}`);
        if (req.method !== 'POST' || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"closing":true}');
        setImmediate(() => shutdown('http').catch(error => { console.error(error.message); process.exitCode = 1; }));
        return;
      }
      app(req, res);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const accounts = {};
    for (const [name, user, family] of [['trainer', trainer, 'trainfit-trainers'], ['client', client, 'trainfit-front'], ['onboardingClient', onboardingClient, 'trainfit-front']]) {
      const response = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-family': family, 'x-client-platform': 'web' }, body: JSON.stringify({ email: user.email, password }) });
      const body = await response.json();
      if (!response.ok || !body.access_token) throw new Error(`Login real de ${name} falló: HTTP ${response.status}`);
      accounts[name] = { id: String(user._id), email: user.email, password, clientFamily: family, accessToken: body.access_token };
    }
    manifest = { status: 'ready', pid: process.pid, startedAt: new Date().toISOString(), url, apiUrl: `${url}/api`, database,
      clientId: String(client._id), trainerId: String(trainer._id), onboardingClientId: String(onboardingClient._id), stageId: String(stage._id), today, timeZone,
      accounts, shutdown: { url: `${url}/__overview_test/shutdown`, method: 'POST', token: shutdownToken },
      fixture: { pendingInitialMeasurements: ['hip'], requestedInitialMeasurements: ['weight', 'waist', 'hip'], naturalWeekWithoutWeight: addDays(monday, -28), emailDelivery: 'disabled', routes: 'real app.js', crons: 'not started' } };
    writeManifest();
    console.log(`[overview-browser] listo: ${url}; manifest: ${manifestPath}`);
    input = readline.createInterface({ input: process.stdin, terminal: false });
    input.on('line', line => { if (line.trim() === 'shutdown') void shutdown('stdin').catch(error => { console.error(error.message); process.exitCode = 1; }); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(signal).catch(error => { console.error(error.message); process.exitCode = 1; }); });
  } catch (error) {
    await shutdown('startup-error').catch(cleanupError => console.error(`[overview-browser] ${cleanupError.message}`));
    throw error;
  }
}

if (require.main === module) main().catch(error => { console.error(`[overview-browser] ${error.stack || error.message}`); process.exitCode = 1; });
module.exports = { main };
