// Perímetros por lado (2026-10, docs/refactor-modelo-datos-estado.md D2).
//
// Antes:  el modal de medidas del cliente escribía bíceps relajado, bíceps
//         contraído y gemelo SIN lado (bicepsRelaxed, bicepsContracted, calf)
//         y los check-ins del profesional, con lado (…L / …R). La ficha del
//         profesional solo pintaba los de lado: lo que apuntaba el cliente no
//         lo veía nadie más que él.
// Ahora:  solo existen los de lado, para los dos.
//
// El valor sin lado se copia a cada lado que ese día esté vacío (lo que ya
// tenga un lado no se pisa) y después desaparece. Idempotente.


const PAIRS = [
  { single: "bicepsRelaxed", left: "bicepsRelaxedL", right: "bicepsRelaxedR" },
  { single: "bicepsContracted", left: "bicepsContractedL", right: "bicepsContractedR" },
  { single: "calf", left: "calfL", right: "calfR" },
];

async function migrateAnthropometrySides(db, { dryRun = false } = {}) {
  const anthropometries = db.collection("anthropometries");
  const filter = { $or: PAIRS.map((pair) => ({ [pair.single]: { $exists: true } })) };
  const stats = { documents: await anthropometries.countDocuments(filter), sidesFilled: 0 };
  if (!stats.documents) return stats;

  const writes = [];
  for await (const doc of anthropometries.find(filter)) {
    const set = {};
    for (const pair of PAIRS) {
      const value = doc[pair.single];
      if (typeof value !== "number") continue;
      for (const side of [pair.left, pair.right]) {
        if (doc[side] === undefined || doc[side] === null) {
          set[side] = value;
          stats.sidesFilled += 1;
        }
      }
    }
    writes.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { ...(Object.keys(set).length ? { $set: set } : {}), $unset: Object.fromEntries(PAIRS.map((pair) => [pair.single, ""])) },
      },
    });
  }
  if (!dryRun) {
    for (let index = 0; index < writes.length; index += 500) {
      await anthropometries.bulkWrite(writes.slice(index, index + 500), { ordered: false });
    }
  }
  return stats;
}

module.exports = { migrateAnthropometrySides };
