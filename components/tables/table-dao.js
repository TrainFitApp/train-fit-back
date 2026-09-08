const userSchema = require("../users/schema");
const tableSchema = require("./table-schema");
const { default: mongoose } = require("mongoose");
const splitSchema = require("../splits/split-schema");
const setSchema = require("../sets/set-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
const serverDomain = process.env.SERVER_DOMAIN;

// 2026-09, revertido 2026-09 bis — "Mis rutinas" enseñaba TODO lo que un
// entrenador hubiera creado alguna vez para el cliente (borradores nunca
// aplicados, fases ya sustituidas). Se acotó a solo la vigente/programada,
// pero el cliente pidió volver a ver TODO lo asignado — quiere poder mirar
// atrás su propia progresión, no solo la fase de hoy. `assignedByTrainerId`
// se estampa en el momento de COPIAR una plantilla al cliente
// (copyTableForClient), antes e independientemente de que se llegue a
// programar con una RoutineAssignment — así que no sirve por sí solo para
// decidir qué enseñar: colaría también las copias que el entrenador dejó a
// medias y nunca llegó a aplicar.
//
// listByClient trae TODAS las fases (activa, superseded, ended) — el
// denominador correcto de "asignado de verdad alguna vez" es "tiene fila en
// RoutineAssignment", no "está vigente ahora": eso es justo lo que separa
// un borrador nunca aplicado (sin fila, se sigue sin ver) de una fase ya
// terminada (con fila, ahora SÍ se ve, para poder repasarla).
//
// No hace falta distinguir "cliente con entrenador" de "autoservicio puro":
// para un cliente sin entrenador, assignedByTrainerId es null en TODAS sus
// tablas (nunca se estampó), así que la primera rama del $or ya las cubre
// todas — el filtro es un no-op exacto para ese caso, sin necesitar una
// consulta aparte para averiguar si hay relación con un entrenador.
async function buildOwnTablesMatch(idUser) {
  const assignments = await routineAssignmentDao.listByClient(idUser);
  const assignedTableIds = assignments.map((assignment) => assignment.tableId);
  return {
    userId: mongoose.Types.ObjectId(idUser),
    $or: [
      { assignedByTrainerId: null },
      ...(assignedTableIds.length ? [{ _id: { $in: assignedTableIds } }] : []),
    ],
  };
}

function normalizeSetForTemplateCopy(setTemp) {
  delete setTemp.doned;
}

async function copyHierarchy(tableDoc) {
  const splits = [];
  const workouts = [];
  const customExercises = [];
  const sets = [];

  tableDoc.splits.forEach((splitTemp) => {
    splitTemp._id = new mongoose.Types.ObjectId();
    splits.push(splitTemp);
    splitTemp.workouts.forEach((workoutTemp) => {
      workoutTemp._id = new mongoose.Types.ObjectId();
      workouts.push(workoutTemp);
      workoutTemp.exercises.forEach((customExerciseTemp) => {
        customExerciseTemp._id = new mongoose.Types.ObjectId();
        customExercises.push(customExerciseTemp);
        customExerciseTemp.sets.forEach((setTemp) => {
          setTemp._id = new mongoose.Types.ObjectId();
          normalizeSetForTemplateCopy(setTemp);
          sets.push(setTemp);
        });
      });
    });
  });

  await setSchema.insertMany(sets);
  await customExerciseSchema.insertMany(customExercises);
  await workoutSchema.insertMany(workouts);
  await splitSchema.insertMany(splits);
}

module.exports = {
  async getTables(page, limit, own = false, idUser = null, defaultOnly = false) {
    if (own && idUser) {
      return tableSchema
        .find(await buildOwnTablesMatch(idUser))
        .skip(page * limit)
        .limit(limit)
        .exec();
    }
    if (defaultOnly && idUser) {
      return tableSchema
        .find({ userId: { $exists: false } })
        .skip(page * limit)
        .limit(limit)
        .exec();
    }
    // All routines: user's own + public templates
    return tableSchema
      .find({
        $or: [
          { userId: mongoose.Types.ObjectId(idUser) },
          { userId: { $exists: false } }
        ]
      })
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async getTableById(id) {
    return tableSchema.findById(id).exec();
  },

  // MVP-trainers — comprobación de propiedad para activateTableForClient:
  // igual que nutritionalGoalDao.findByIdAndUserId, evita activar una tabla
  // que no es de este cliente (ver auditoría de seguridad de exercises,
  // mismo criterio: nunca confiar en un id de ruta sin verificar dueño).
  async getTableByIdAndUserId(id, userId) {
    return tableSchema.findOne({ _id: id, userId }).exec();
  },

  async copyTable(idUser, idTable) {
    try {
      const tableD = await tableSchema.findById(idTable);
      if (!tableD) throw new Error("Table not found");
      const tableDoc = tableD.toObject();

      await copyHierarchy(tableDoc);

      delete tableDoc._id;
      return await tableSchema.create({
        ...tableDoc,
        userId: idUser,
      });
    } catch (e) {
      throw e;
    }
  },

  // MVP-trainers F11: copia una plantilla HACIA un cliente (asignada por su
  // profesional). A diferencia de copyTable, escribe assignedByTrainerId y,
  // deliberadamente, NO toca tableInUse/workoutInUse del cliente — asignar
  // una rutina no la activa sola (ver F11 punto 7.7).
  async copyTableForClient(clientId, idTable, trainerId) {
    try {
      const tableD = await tableSchema.findById(idTable);
      if (!tableD) throw new Error("Table not found");
      const tableDoc = tableD.toObject();

      await copyHierarchy(tableDoc);

      delete tableDoc._id;
      return await tableSchema.create({
        ...tableDoc,
        userId: clientId,
        assignedByTrainerId: trainerId,
      });
    } catch (e) {
      throw e;
    }
  },

  async duplicateTable(idUser, idTable) {
    try {
      const tableD = await tableSchema.findById(idTable);
      if (!tableD) throw new Error("Table not found");
      const tableDoc = tableD.toObject();

      tableDoc.name = tableDoc.name + " copia";

      await copyHierarchy(tableDoc);

      delete tableDoc._id;
      return await tableSchema.create({
        ...tableDoc,
        userId: idUser,
      });
    } catch (e) {
      throw e;
    }
  },

  async copySharedTable(idUser, idTable) {
    try {
      const splits = [];
      const workouts = [];
      const customExercises = [];
      const sets = [];

      let sharedTable = await tableSchema.findById(idTable);
      sharedTable = sharedTable.toObject();

      sharedTable.splits.forEach((sTemp) => {
        sTemp._id = new mongoose.Types.ObjectId();
        splits.push(sTemp);
        sTemp.workouts.forEach((wTemp) => {
          wTemp._id = new mongoose.Types.ObjectId();
          workouts.push(wTemp);
          wTemp.exercises.forEach((ceTemp) => {
            wTemp._id = new mongoose.Types.ObjectId();
            customExercises.push(ceTemp);
            ceTemp.sets.forEach((sTemp) => {
              sTemp._id = new mongoose.Types.ObjectId();
              sets.push(sTemp);
            });
          });
        });
      });

      await setSchema.insertMany(sets);
      await customExerciseSchema.insertMany(customExercises);
      await workoutSchema.insertMany(workouts);
      await splitSchema.insertMany(splits);

      delete sharedTable._id;
      delete sharedTable.userId;
      sharedTable = await tableSchema.create(sharedTable);

      return `${serverDomain}/api/tables/share/${idUser}/${idTable}`;
    } catch (e) {
      throw e;
    }
  },

  async getSearchTables(page, limit, search, isOwn, idUser, defaultOnly = false) {
    try {
      const normalizedSearch = (search || "").trim();
      const searchTerms = normalizedSearch
        .split(" ")
        .map((term) => term.trim())
        .filter(Boolean);

      const baseMatch = {};

      if (searchTerms.length > 0) {
        baseMatch.$and = searchTerms.map((term) => ({
          name: { $regex: term, $options: "i" },
        }));
      }

      const buildLightSearchPipeline = (extraMatch = {}) => [
        { $match: { ...baseMatch, ...extraMatch } },
        { $project: { _id: 1, name: 1, urlImage: 1, splits: 1, assignedByTrainerId: 1 } },
        {
          $lookup: {
            from: "splits",
            let: { splitIds: "$splits" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$splitIds"] } } },
              { $project: { _id: 1, workoutsCount: { $size: "$workouts" } } },
            ],
            as: "splitStats",
          },
        },
        {
          $addFields: {
            microcyclesCount: { $size: "$splits" },
            workoutsCount: {
              $ifNull: [{ $arrayElemAt: ["$splitStats.workoutsCount", 0] }, 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            urlImage: 1,
            microcyclesCount: 1,
            workoutsCount: 1,
            assignedByTrainerId: 1,
          },
        },
        { $skip: page * limit },
        { $limit: limit },
      ];

      if (isOwn) {
        const ownMatch = await buildOwnTablesMatch(idUser);
        return await tableSchema.aggregate(buildLightSearchPipeline(ownMatch));
      }

      if (defaultOnly) {
        return await tableSchema.aggregate(
          buildLightSearchPipeline({ userId: { $exists: false } })
        );
      }

      // All routines: user's own + public templates
      return await tableSchema.aggregate(
        buildLightSearchPipeline({
          $or: [
            { userId: mongoose.Types.ObjectId(idUser) },
            { userId: { $exists: false } }
          ]
        })
      );
    } catch (e) {
      throw e;
    }
  },

  async createTable(table) {
    return tableSchema.create(table);
  },

  async createTableToUser(idUser, standardTable) {
    try {
      const tableDoc = await tableSchema.create({
        ...standardTable,
        userId: idUser,
      });
      const addTableToUser = {
        $set: { tableInUse: tableDoc._id },
        $unset: { workoutInUse: "" },
      };
      await userSchema.findByIdAndUpdate(idUser, addTableToUser);
      return tableDoc;
    } catch (err) {
      throw err;
    }
  },

  // MVP-trainers — paso 2 de F11 punto 7.7: activar una rutina ya asignada.
  // Mismo `$set`/`$unset` que ya usa createTableToUser (self-service): fijar
  // tableInUse SIEMPRE desactiva implícitamente cualquier otra rutina — es
  // un puntero único en User, no un booleano por Table, así que no hace
  // falta (ni existe el riesgo de) desincronizar "las demás" al activar una.
  async setTableInUseForClient(clientId, tableId) {
    await userSchema.findByIdAndUpdate(clientId, {
      $set: { tableInUse: tableId },
      $unset: { workoutInUse: "" },
    });
  },

  // Borrado coherente de fases/rutinas — vacía tableInUse/workoutInUse SIN
  // fijar una tabla nueva, para cuando se quita la fase que el cliente tenía
  // en curso y no hay ninguna anterior que restaurar (era la primera fase de
  // su historia). Mismo $unset que ya usa setTableInUseForClient, sin el
  // $set de una tabla nueva.
  async clearTableInUseForClient(clientId) {
    await userSchema.findByIdAndUpdate(clientId, {
      $unset: { tableInUse: "", workoutInUse: "" },
    });
  },

  // MVP-trainers F11: crea una rutina NUEVA directamente para un cliente,
  // asignada por su profesional. A diferencia de createTableToUser, NO
  // activa la rutina (no toca tableInUse/workoutInUse) — ver F11 punto 7.7.
  async createTableForClient(clientId, standardTable, trainerId) {
    return tableSchema.create({
      ...standardTable,
      userId: clientId,
      assignedByTrainerId: trainerId,
    });
  },

  // Rutinas -> Plantillas (rediseño 2026-08): crea una Table propia del
  // profesional (userId=trainerId, SIN assignedByTrainerId — no es una
  // rutina asignada a un cliente, es su propia plantilla reutilizable).
  // Queda listada por getTables(own=true, trainerId) y es editable por el
  // mismo Planificador que las rutinas de cliente, vía canAccessUserTable
  // (rama "dueño real") — sin código de acceso nuevo.
  async createTableForTrainer(trainerId, standardTable) {
    return tableSchema.create({
      ...standardTable,
      userId: trainerId,
    });
  },

  async updateTable(id, name, userId, adminMode = false) {
    const update = { $set: { name: name } };
    try {
      const query = adminMode ? { _id: id } : { _id: id, userId: userId };
      const docTable = await tableSchema.findOneAndUpdate(query, update, {
        new: true,
      });
      if (!docTable) throw new Error("Table not found or access denied");
      return { name: docTable.name };
    } catch (err) {
      throw err;
    }
  },

  async deleteTable(idUser, idTable, adminMode = false) {
    try {
      const query = adminMode ? { _id: idTable } : { _id: idTable, userId: idUser };
      return await tableSchema.deleteOne(query).exec();
    } catch (e) {
      throw e;
    }
  },

  async deleteTableSplit(idTable, idSplit) {
    const deleteSplit = {
      $pull: { splits: idSplit },
    };

    return tableSchema.findByIdAndUpdate(idTable, deleteSplit, {}).exec();
  },

  async countUserTables(userId) {
    return tableSchema.countDocuments({ userId }).exec();
  },

  // MVP-trainers D10: cuenta solo las rutinas SIN assignedByTrainerId — las
  // asignadas por un profesional no deben contar contra el límite FREE propio
  // del cliente. Ver table-service.js#countEffectiveUserTables para cuándo se
  // usa esta función vs. countUserTables (depende de si hay relación activa).
  async countOwnUserTables(userId) {
    return tableSchema.countDocuments({ userId, assignedByTrainerId: null }).exec();
  },

  // Fase 2 Coach Pro — actividad de entrenamiento de un cliente en un rango,
  // para la dimensión "entrenamiento" de la adherencia multidimensional.
  //
  // Vía agregación y NO vía getTables + recorrido en Node por dos motivos:
  // Table lleva mongoose-autopopulate en cascada (splits -> workouts ->
  // customExercises -> sets), así que una simple lectura del documento
  // arrastra la rutina ENTERA con todas sus series solo para contar fechas;
  // y una agregación ignora el plugin por completo. Devuelve únicamente las
  // fechas — el reparto por semanas se hace en el servicio.
  //
  // `rest: true` son días de descanso del microciclo: existen como Workout
  // pero no son una sesión que el cliente deba completar, así que quedan
  // fuera del numerador igual que del denominador (ver countPlannedSessionsPerMicrocycle).
  async listCompletedWorkoutDates(userId, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    const rows = await tableSchema.aggregate([
      { $match: { userId: ObjectId(userId) } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splitDocs" } },
      { $unwind: "$splitDocs" },
      { $lookup: { from: "workouts", localField: "splitDocs.workouts", foreignField: "_id", as: "workoutDocs" } },
      { $unwind: "$workoutDocs" },
      {
        $match: {
          "workoutDocs.date": { $gte: fromDate, $lte: toDate },
          "workoutDocs.rest": { $ne: true },
          "workoutDocs.isPlannedRestDay": { $ne: true },
        },
      },
      { $project: { _id: 0, date: "$workoutDocs.date" } },
    ]);
    return rows.map((row) => row.date);
  },

  // Fase 6 Coach Pro — la misma consulta que listCompletedWorkoutDates pero
  // para VARIOS clientes de una vez. Es lo que permite que el evaluador
  // nocturno ofrezca "sesiones entrenadas" como métrica de regla sin pasar
  // de ~7 consultas por profesional a 7 + N.
  async listCompletedWorkoutDatesForUsers(userIds, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    if (!userIds?.length) return [];
    const rows = await tableSchema.aggregate([
      { $match: { userId: { $in: userIds.map((id) => ObjectId(String(id))) } } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splitDocs" } },
      { $unwind: "$splitDocs" },
      { $lookup: { from: "workouts", localField: "splitDocs.workouts", foreignField: "_id", as: "workoutDocs" } },
      { $unwind: "$workoutDocs" },
      {
        $match: {
          "workoutDocs.date": { $gte: fromDate, $lte: toDate },
          "workoutDocs.rest": { $ne: true },
          "workoutDocs.isPlannedRestDay": { $ne: true },
        },
      },
      { $project: { _id: 0, userId: 1, date: "$workoutDocs.date" } },
    ]);
    return rows;
  },

  // Fase 6 Coach Pro — cada SERIE COMPLETADA de un cliente en un rango, con
  // su fecha, ejercicio, repeticiones y peso. Es la materia prima de
  // volumen, PRs y evolución de cargas (§17).
  //
  // Deliberadamente NO se usa en el evaluador nocturno: una serie por
  // documento significa miles de filas por cliente y trimestre, asequible
  // para UNA ficha abierta y ruinoso multiplicado por toda la cartera. Las
  // reglas usan el recuento de sesiones (listCompletedWorkoutDatesForUsers),
  // que sí es barato.
  //
  // `sets.doned` filtra a lo realmente hecho: una serie planificada y no
  // ejecutada no es volumen.
  async listCompletedSetsForUser(userId, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    return tableSchema.aggregate([
      { $match: { userId: ObjectId(String(userId)) } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splitDocs" } },
      { $unwind: "$splitDocs" },
      { $lookup: { from: "workouts", localField: "splitDocs.workouts", foreignField: "_id", as: "workoutDocs" } },
      { $unwind: "$workoutDocs" },
      {
        $match: {
          "workoutDocs.date": { $gte: fromDate, $lte: toDate },
          "workoutDocs.rest": { $ne: true },
          "workoutDocs.isPlannedRestDay": { $ne: true },
        },
      },
      {
        $lookup: {
          from: "customexercises",
          localField: "workoutDocs.exercises",
          foreignField: "_id",
          as: "customExercises",
        },
      },
      { $unwind: "$customExercises" },
      {
        $lookup: {
          from: "exercises",
          localField: "customExercises.exercise",
          foreignField: "_id",
          as: "exerciseInfo",
        },
      },
      { $unwind: { path: "$exerciseInfo", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "sets", localField: "customExercises.sets", foreignField: "_id", as: "setDocs" } },
      { $unwind: "$setDocs" },
      { $match: { "setDocs.doned": true } },
      {
        $project: {
          _id: 0,
          date: "$workoutDocs.date",
          workoutId: "$workoutDocs._id",
          // Movimiento 3 Coach Pro — a qué microciclo pertenece la serie.
          // Va en la MISMA agregación (el $unwind de splits ya está hecho
          // arriba, solo hay que proyectar dos campos más) para que comparar
          // bloque contra bloque no cueste una segunda consulta cara.
          splitId: "$splitDocs._id",
          splitName: "$splitDocs.name",
          // El nombre del ejercicio del catálogo; si el CustomExercise no
          // apunta a ninguno (ejercicio propio del usuario), se cae a su
          // propio nombre para no perder la serie del agregado.
          exerciseName: { $ifNull: ["$exerciseInfo.name", "$customExercises.name"] },
          reps: "$setDocs.reps",
          weight: "$setDocs.weight",
          rir: "$setDocs.rir",
          // Tarea 4 (2026-09) — grupos musculares implicados, del catálogo.
          // Solo lo que ya guarda Exercise; no se infiere nada para un
          // ejercicio propio del cliente sin ficha en el catálogo.
          muscleGroups1: "$exerciseInfo.muscleGroups1",
          muscleGroups2: "$exerciseInfo.muscleGroups2",
          // 2026-09 — pulso de readiness/esfuerzo (1-5) de LA SESIÓN, no de
          // la serie: se repite en cada set de la misma sesión a propósito
          // (mismo criterio que splitId/splitName arriba, misma agregación
          // ya hecha, sin consulta nueva). buildBlockReadiness deduplica por
          // fecha antes de promediar, igual que buildBlockTraining ya hace
          // para contar sesiones.
          readinessPre: "$workoutDocs.readinessPre",
          perceivedEffortPost: "$workoutDocs.perceivedEffortPost",
          // 2026-09 — "elegir el workout a ver": nombre del Workout (p.ej.
          // "Día de pierna") tal cual está en ESA sesión concreta. Se
          // empareja por NOMBRE, no por posición en splits[].workouts (que es
          // el criterio que sí usa el comparador del Planner, ver
          // planner-compare.ts) — para este selector es el mismo criterio que
          // ya usa "comparar por ejercicio" (exerciseName), y evita
          // reconstruir el índice del array dentro de la agregación.
          workoutName: "$workoutDocs.name",
        },
      },
    ]);
  },

  // 2026-09 — una fila por SESIÓN (Workout), con nº total de series y
  // cuántas se marcaron hechas. Alimenta la métrica "Adherencia" del
  // comparador de Entrenamiento: a diferencia de listCompletedSetsForUser,
  // aquí NO se filtra `doned:true` antes de agrupar — hace falta contar
  // también las series pautadas que no se llegaron a hacer, porque
  // finishWorkout no exige tenerlas todas para dar la sesión por terminada
  // (ver current-workout.page.ts#finishWorkout en el frontend).
  async listSessionAdherenceForUser(userId, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    return tableSchema.aggregate([
      { $match: { userId: ObjectId(String(userId)) } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splitDocs" } },
      { $unwind: "$splitDocs" },
      { $lookup: { from: "workouts", localField: "splitDocs.workouts", foreignField: "_id", as: "workoutDocs" } },
      { $unwind: "$workoutDocs" },
      {
        $match: {
          "workoutDocs.date": { $gte: fromDate, $lte: toDate },
          "workoutDocs.rest": { $ne: true },
          "workoutDocs.isPlannedRestDay": { $ne: true },
        },
      },
      {
        $lookup: {
          from: "customexercises",
          localField: "workoutDocs.exercises",
          foreignField: "_id",
          as: "customExercises",
        },
      },
      { $unwind: "$customExercises" },
      { $lookup: { from: "sets", localField: "customExercises.sets", foreignField: "_id", as: "setDocs" } },
      { $unwind: "$setDocs" },
      {
        $group: {
          _id: "$workoutDocs._id",
          date: { $first: "$workoutDocs.date" },
          splitId: { $first: "$splitDocs._id" },
          splitName: { $first: "$splitDocs.name" },
          workoutName: { $first: "$workoutDocs.name" },
          totalSets: { $sum: 1 },
          donedSets: { $sum: { $cond: ["$setDocs.doned", 1, 0] } },
        },
      },
    ]);
  },

  // Sesiones que el cliente TIENE que hacer en un microciclo: los workouts
  // no-descanso del último microciclo de la rutina que usa ahora mismo. Es
  // el denominador honesto de "adherencia al entrenamiento": el modelo no
  // guarda en qué día de calendario tocaba cada sesión, así que la frecuencia
  // semanal prescrita es lo único que se puede afirmar sin inventar un
  // calendario que no existe.
  async countPlannedSessionsPerMicrocycle(tableId) {
    const { ObjectId } = require("mongoose").Types;
    const [row] = await tableSchema.aggregate([
      { $match: { _id: ObjectId(tableId) } },
      { $project: { lastSplit: { $arrayElemAt: ["$splits", -1] } } },
      { $lookup: { from: "splits", localField: "lastSplit", foreignField: "_id", as: "splitDoc" } },
      { $unwind: "$splitDoc" },
      { $lookup: { from: "workouts", localField: "splitDoc.workouts", foreignField: "_id", as: "workoutDocs" } },
      {
        $project: {
          _id: 0,
          planned: {
            $size: {
              $filter: {
                input: "$workoutDocs",
                cond: {
                  $and: [{ $ne: ["$$this.rest", true] }, { $ne: ["$$this.isPlannedRestDay", true] }],
                },
              },
            },
          },
        },
      },
    ]);
    return row?.planned || 0;
  },

  // Movimiento 1 Coach Pro — lo mismo que countPlannedSessionsPerMicrocycle
  // pero para VARIAS rutinas de una vez, para que la vista de Cartera pueda
  // calcular la adherencia al entrenamiento de toda la cartera sin una
  // agregación por cliente. Devuelve un Map tableId(string) -> nº de
  // sesiones; una rutina sin microciclos simplemente no aparece, y quien
  // pregunta lo trata como 0 igual que arriba.
  /**
   * Progreso del plan: cuántas sesiones tiene la rutina entera y cuántas se
   * han hecho ya (Workout con fecha).
   *
   * Sustituye a countPlannedSessionsPerMicrocycleForTables, que solo miraba
   * el ÚLTIMO microciclo y lo multiplicaba por las semanas del periodo. Un
   * microciclo se mide en sesiones y `Split` no guarda duración, así que esa
   * multiplicación era una suposición: con 2 microciclos de 2 sesiones
   * anunciaba 8 esperadas donde el plan tiene 4.
   *
   * Los workouts marcados como descanso (`rest`) no cuentan como sesión.
   */
  async getPlanSessionProgressForTables(tableIds) {
    const { ObjectId } = require("mongoose").Types;
    if (!tableIds?.length) return new Map();
    const rows = await tableSchema.aggregate([
      { $match: { _id: { $in: tableIds.map((id) => ObjectId(String(id))) } } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splitDocs" } },
      {
        $project: {
          workoutIds: {
            $reduce: {
              input: "$splitDocs",
              initialValue: [],
              in: { $concatArrays: ["$$value", { $ifNull: ["$$this.workouts", []] }] },
            },
          },
        },
      },
      { $lookup: { from: "workouts", localField: "workoutIds", foreignField: "_id", as: "workoutDocs" } },
      {
        $project: {
          sesiones: {
            $filter: {
              input: "$workoutDocs",
              cond: {
                $and: [{ $ne: ["$$this.rest", true] }, { $ne: ["$$this.isPlannedRestDay", true] }],
              },
            },
          },
        },
      },
      {
        $project: {
          plannedTotal: { $size: "$sesiones" },
          completedTotal: {
            $size: {
              $filter: { input: "$sesiones", cond: { $ne: [{ $ifNull: ["$$this.date", null] }, null] } },
            },
          },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        { plannedTotal: row.plannedTotal || 0, completedTotal: row.completedTotal || 0 },
      ])
    );
  },

  // Tarea 5 (2026-09) — splits+workouts de VARIAS rutinas de una vez, para
  // la adherencia de entrenamiento por ventana+fase (routine-assignment-
  // schedule.js#computeWindowedTrainingProgress necesita proyectar sobre la
  // estructura real de cada tabla que gobernó algún tramo de la ventana).
  //
  // Por agregación (mismo motivo que getPlanSessionProgressForTables: el
  // autopopulate en cascada de Table arrastra ejercicios/series enteras solo
  // para leer nombre+fecha+flags de cada Workout) pero SIN copiar tal cual
  // su $lookup: aquí SÍ importa el orden (día N de la proyección = posición
  // N en splits[].workouts[] aplanado), y $lookup con un array en
  // localField NO garantiza devolver `as` en el mismo orden que ese array
  // — a diferencia del autopopulate de Mongoose, que sí lo preserva (por
  // eso getActiveSchedule usa getTableById, no una agregación). Aquí se
  // proyectan también los ids ORDENADOS (splits de la tabla, workouts de
  // cada split — campos reales del documento, no tocados por el $lookup) y
  // se reconstruye el orden en JS con un Map por _id antes de devolver.
  async getSplitsForTables(tableIds) {
    const { ObjectId } = require("mongoose").Types;
    if (!tableIds?.length) return new Map();
    const rows = await tableSchema.aggregate([
      { $match: { _id: { $in: tableIds.map((id) => ObjectId(String(id))) } } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splitDocs" } },
      {
        $project: {
          splitIds: "$splits",
          splitDocs: { _id: 1, workouts: 1 },
        },
      },
      {
        $project: {
          splitIds: 1,
          splitDocs: 1,
          workoutIds: {
            $reduce: {
              input: "$splitDocs",
              initialValue: [],
              in: { $concatArrays: ["$$value", { $ifNull: ["$$this.workouts", []] }] },
            },
          },
        },
      },
      {
        $lookup: {
          from: "workouts",
          localField: "workoutIds",
          foreignField: "_id",
          as: "workoutDocs",
          pipeline: [{ $project: { _id: 1, name: 1, isPlannedRestDay: 1, date: 1, rest: 1 } }],
        },
      },
      { $project: { splitIds: 1, splitDocs: 1, workoutDocs: 1 } },
    ]);

    return new Map(
      rows.map((row) => {
        const workoutById = new Map((row.workoutDocs || []).map((w) => [String(w._id), w]));
        const splitById = new Map((row.splitDocs || []).map((s) => [String(s._id), s]));
        const splits = (row.splitIds || [])
          .map((id) => splitById.get(String(id)))
          .filter(Boolean)
          .map((split) => ({
            workouts: (split.workouts || []).map((wid) => workoutById.get(String(wid))).filter(Boolean),
          }));
        return [String(row._id), { splits }];
      })
    );
  },

  async getExerciseHistoryStats(userId, exerciseId, exerciseName) {
    const { ObjectId } = require("mongoose").Types;

    function parseTimeToSeconds(timeStr) {
      if (!timeStr) return 0;
      const parts = String(timeStr).split(":");
      if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }
      return parseInt(parts[0], 10) || 0;
    }

    const matchExercise = exerciseId
      ? { "exerciseInfo._id": ObjectId(exerciseId) }
      : { "exerciseInfo.name": exerciseName };

    const pipeline = [
      { $match: { userId: ObjectId(userId) } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splits" } },
      { $unwind: { path: "$splits", preserveNullAndEmptyArrays: false } },
      { $lookup: { from: "workouts", localField: "splits.workouts", foreignField: "_id", as: "workouts" } },
      { $unwind: { path: "$workouts", preserveNullAndEmptyArrays: false } },
      { $match: { $or: [{ "workouts.rest": { $ne: true } }, { "workouts.rest": { $exists: false } }] } },
      { $match: { $or: [{ "workouts.isPlannedRestDay": { $ne: true } }, { "workouts.isPlannedRestDay": { $exists: false } }] } },
      { $lookup: { from: "customexercises", localField: "workouts.exercises", foreignField: "_id", as: "customExercises" } },
      { $unwind: { path: "$customExercises", preserveNullAndEmptyArrays: false } },
      { $lookup: { from: "exercises", localField: "customExercises.exercise", foreignField: "_id", as: "exerciseInfo" } },
      { $unwind: { path: "$exerciseInfo", preserveNullAndEmptyArrays: true } },
      { $match: matchExercise },
      {
        $addFields: {
          exerciseType: {
            $cond: [{ $ifNull: ["$exerciseInfo.isIsometric", false] }, "isometric",
              { $cond: [{ $ifNull: ["$exerciseInfo.isCardio", false] }, "cardio", "strength"] }
            ]
          }
        }
      },
      { $lookup: { from: "sets", localField: "customExercises.sets", foreignField: "_id", as: "sets" } },
      { $unwind: { path: "$sets", preserveNullAndEmptyArrays: false } },
      { $match: { "sets.doned": true } },
      {
        $group: {
          _id: "$exerciseType",
          allSets: { $push: "$$ROOT" },
        }
      },
    ];

    const results = await tableSchema.aggregate(pipeline);

    if (results.length === 0) {
      return { exerciseId, exerciseName, exerciseType: "strength", bestSet: null, maxWeightEver: 0, bestVelocityEver: null, bestTimeEver: null, bestTimeSecondsEver: 0 };
    }

    const r = results[0];
    const exerciseType = r._id;

    let bestSet = null;
    let bestVolume = 0;
    let maxWeightEver = 0;
    let bestTimeSeconds = 0;
    let bestTimeStr = null;
    let bestVelocity = 0;

    for (const doc of r.allSets) {
      const s = doc.sets;
      if (exerciseType === "strength") {
        const candidates = [
          { weight: s.weight || 0, reps: s.reps || 0 },
          ...(s.dropSetSeries || []).map((cs) => ({
            weight: cs.weight || 0,
            reps: cs.reps || 0,
          })),
          ...(s.restPauseSeries || []).map((cs) => ({
            weight: cs.weight || 0,
            reps: cs.reps || 0,
          })),
        ];
        candidates.forEach((c) => {
          const volume = c.weight * c.reps;
          if (volume > bestVolume) {
            bestSet = { weight: c.weight, reps: c.reps };
            bestVolume = volume;
          }
          if (c.weight > maxWeightEver) maxWeightEver = c.weight;
        });
      } else if (exerciseType === "cardio") {
        const vel = s.velocity || 0;
        if (vel > bestVelocity) bestVelocity = vel;
      } else if (exerciseType === "isometric") {
        const secs = parseTimeToSeconds(s.time);
        if (secs > bestTimeSeconds) {
          bestTimeSeconds = secs;
          bestTimeStr = s.time || null;
        }
      }
    }

    return {
      exerciseId,
      exerciseName,
      exerciseType,
      bestSet,
      maxWeightEver,
      bestVelocityEver: exerciseType === "cardio" ? (bestVelocity || null) : null,
      bestTimeEver: exerciseType === "isometric" ? bestTimeStr : null,
      bestTimeSecondsEver: exerciseType === "isometric" ? bestTimeSeconds : 0,
    };
  },
};
