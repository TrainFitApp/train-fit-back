const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Borrado de cuenta declarativo (docs/analisis-modelo-datos.md, P7).
//
// Cada schema que guarda referencias a un usuario declara qué pasa con ellas
// cuando se borra su cuenta:
//
//   Schema.plugin(accountCascade, {
//     owners: ["trainerId", "clientId"],
//     detach: { resolvedBy: "unset", clientIds: "pull" },
//     authorship: ["assignedByTrainerId"],
//     keep: async (userId) => {...},
//     stage: STAGE.catalog,
//   });
//
// - owners: el documento es de ese usuario (basta con uno): se borra con
//   `deleteMany` del modelo, así que corren sus propios hooks de cascada
//   (sesiones de una rutina, archivos de un vídeo…).
// - detach: referencias que no hacen dueño y se sueltan en los documentos que
//   quedan: "unset" (campo suelto), "pull" (lista de ids), un update de
//   Mongo propio, o una función `(userId, Model)` para lo que necesita reglas.
// - authorship: marcas de autoría en datos de OTRO (la comida que pautó el
//   entrenador sigue siendo del cliente): se quedan tal cual. Valen por
//   nombre de campo en cualquier nivel del documento.
// - keep: corre antes de borrar, para conservar lo que otros siguen usando
//   (receta en el plato de otro, ejercicio en sesiones de otro).
// - stage: orden. Primero el contenido y las relaciones de la cuenta; después
//   el catálogo que otros pueden estar usando (recetas, ejercicios), cuando ya
//   no cuenta el uso que hacía la propia cuenta; al final los productos, que
//   también se usan dentro de las recetas.
//
// integration/account-deletion.test.js recorre todos los modelos: si un campo
// que apunta a un usuario no está en owners, detach ni authorship, falla con
// el nombre del modelo y del campo.

const STAGE = Object.freeze({ content: 0, catalog: 1, products: 2 });
const DETACH_MODES = new Set(["unset", "pull"]);

function accountCascade(schema, declaration = {}) {
  const { owners = [], detach = {}, authorship = [], keep = null, stage = STAGE.content } = declaration;
  for (const [field, action] of Object.entries(detach)) {
    const valid = DETACH_MODES.has(action) || typeof action === "function" || (action && typeof action === "object");
    if (!valid) throw new Error(`accountCascade: acción no válida para ${field}`);
  }
  if (!Object.values(STAGE).includes(stage)) throw new Error(`accountCascade: stage no válido (${stage})`);
  schema.statics.accountCascade = Object.freeze({ owners, detach, authorship, keep, stage });
}

// Todos los modelos, también los de rutas que el proceso no ha montado (un
// script que borra usuarios no carga la app entera).
const COMPONENTS_DIR = path.resolve(__dirname, "..");
let schemasLoaded = false;
function loadAllSchemas() {
  if (schemasLoaded) return;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/(^|-)schema\.js$/.test(entry.name)) require(full);
    }
  };
  walk(COMPONENTS_DIR);
  schemasLoaded = true;
}

// Modelos con declaración. Un discriminador hereda los statics de su base:
// solo cuenta si declara los suyos.
function declaredModels() {
  loadAllSchemas();
  return mongoose
    .modelNames()
    .map((name) => mongoose.model(name))
    .filter((model) => {
      if (!model.accountCascade) return false;
      if (!model.baseModelName) return true;
      return mongoose.model(model.baseModelName).accountCascade !== model.accountCascade;
    })
    .map((model) => ({ name: model.modelName, model, declaration: model.accountCascade }))
    .sort((a, b) => a.declaration.stage - b.declaration.stage || a.name.localeCompare(b.name));
}

// Las escrituras directas suben la versión del documento, como pide
// util/embedded-store.js a quien lee-cambia-reescribe contenido embebido.
function detachUpdate(model, action, field, userId) {
  const update = action === "unset" ? { $unset: { [field]: "" } } : action === "pull" ? { $pull: { [field]: userId } } : action;
  const versionKey = model.schema.options.versionKey;
  return versionKey ? { ...update, $inc: { ...update.$inc, [versionKey]: 1 } } : update;
}

/**
 * Borra o suelta todo lo que la cuenta tiene en las demás colecciones. Lo
 * llama el hook de borrado de components/users/user-schema.js, antes de borrar el
 * propio usuario.
 */
async function deleteAccountData(userId) {
  const id = new mongoose.Types.ObjectId(String(userId));
  for (const { model, declaration } of declaredModels()) {
    if (declaration.keep) await declaration.keep(id, model);
    if (declaration.owners.length) {
      await model.deleteMany({ $or: declaration.owners.map((field) => ({ [field]: id })) });
    }
    for (const [field, action] of Object.entries(declaration.detach)) {
      if (typeof action === "function") await action(id, model);
      else await model.updateMany({ [field]: id }, detachUpdate(model, action, field, id));
    }
  }
}

module.exports = { STAGE, accountCascade, declaredModels, deleteAccountData, loadAllSchemas };
