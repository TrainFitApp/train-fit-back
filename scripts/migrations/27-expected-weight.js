// Carga pautada aparte de la levantada (2026-10-09, QA entrenador ↔ cliente).
//
// Hasta ahora la «serie objetivo» guardaba la carga pautada en `weight`, el
// mismo campo que el cliente rellena al hacerla: al apuntar 42,5 kg sobre una
// pauta de 40, la pauta desaparecía. Desde este paso la pauta va en
// `expectedWeight` y `weight` es solo lo levantado.
//
//   workouts   en una serie SIN hacer (`doned` distinto de true), `weight`
//              pasa a `expectedWeight` (si no tenía ya una). Lo que había ahí
//              era la pauta, o la carga que el cliente veía escrita y que se
//              guardaba al marcarla: la app la sigue proponiendo igual.
//              Las series hechas no se tocan: su `weight` es lo levantado, y
//              la pauta que se pisó ya no se puede recuperar.
//
// Idempotente: tras pasarlo ninguna serie sin hacer conserva `weight`.

const BATCH_SIZE = 500;

const pendingWithWeight = { $elemMatch: { weight: { $ne: null }, doned: { $ne: true } } };

function moveSet(set) {
  if (set?.doned === true || set?.weight == null) return set;
  const next = { ...set };
  if (next.expectedWeight == null) next.expectedWeight = next.weight;
  delete next.weight;
  return next;
}

async function migrateExpectedWeight(db, { dryRun = false } = {}) {
  const workouts = db.collection("workouts");
  const filter = { "exercises.sets": pendingWithWeight };
  let sessions = 0;
  let sets = 0;
  let operations = [];
  const flush = async () => {
    if (!dryRun && operations.length) await workouts.bulkWrite(operations, { ordered: false });
    operations = [];
  };

  for await (const workout of workouts.find(filter, { projection: { exercises: 1 } })) {
    let moved = 0;
    const exercises = (workout.exercises || []).map((exercise) => ({
      ...exercise,
      sets: (exercise.sets || []).map((set) => {
        const next = moveSet(set);
        if (next !== set) moved += 1;
        return next;
      }),
    }));
    if (!moved) continue;
    sessions += 1;
    sets += moved;
    // El entrenamiento lleva contenido embebido con compare-and-swap sobre __v.
    operations.push({ updateOne: { filter: { _id: workout._id }, update: { $set: { exercises }, $inc: { __v: 1 } } } });
    if (operations.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { workouts: sessions, sets };
}

module.exports = { migrateExpectedWeight, moveSet };
