const userSchema = require("../users/user-schema");
const tableSchema = require("./table-schema");
const { default: mongoose } = require("mongoose");
const workoutSchema = require("../workouts/workout-schema");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
const { stripExecutionForTemplate } = require("./table-template-copy");
const { cloneWorkout, newId, plain } = require("../workouts/workout-tree");

// Sesiones de las rutinas de uno o varios usuarios, una fila por sesión con
// su microciclo (`splits`, ya desenrollado) y la sesión (`workoutDocs`). Los
// microciclos van embebidos en la tabla (2026-10): un solo $lookup.
function sessionsPipeline(match) {
  return [
    { $match: match },
    { $project: { userId: 1, splits: 1 } },
    { $unwind: "$splits" },
    { $lookup: { from: "workouts", localField: "splits.workouts", foreignField: "_id", as: "workoutDocs" } },
    { $unwind: "$workoutDocs" },
  ];
}

// Sesiones con fecha en el rango que no son descanso.
function completedSessionsMatch(fromDate, toDate) {
  return {
    $match: {
      "workoutDocs.date": { $gte: fromDate, $lte: toDate },
      "workoutDocs.rest": { $ne: true },
      "workoutDocs.isPlannedRestDay": { $ne: true },
    },
  };
}

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
// listByClient trae TODAS las fases (pasadas, en curso y programadas) — el
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
// Bug real (2026-09): getClientTables (trainer viendo la ficha de UN
// cliente) reutilizaba buildOwnTablesMatch/getTables(own=true) tal cual —
// la MISMA consulta que "Mis rutinas" del cliente (table-controller.js),
// pensada para ocultarle al cliente los borradores que su entrenador dejó
// a medias. Pero un trainer que acaba de asignar/crear una rutina para su
// cliente (assignTable) SIEMPRE cae en ese caso hasta que la programa como
// fase (RoutineAssignment) — así que la rutina recién asignada desaparecía
// de su propia ficha antes de poder programarla: no había nada que elegir
// en "Programar", punto muerto. El trainer necesita ver TODO lo que él
// mismo asignó a este cliente, programado o no — a diferencia de "Mis
// rutinas" del cliente, aquí no hace falta filtrar borradores.
async function buildAssignedByTrainerMatch(clientId, trainerId) {
  return {
    userId: mongoose.Types.ObjectId(clientId),
    assignedByTrainerId: mongoose.Types.ObjectId(trainerId),
  };
}

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

// Copia una rutina entera: microciclos y sesiones con ids nuevos. Cada
// sesión conserva su estado (como hizo siempre la copia de rutinas); sus
// series pierden su ejecución (workout-tree.js#cloneSet). Las notas
// ancladas no viajan con la copia (nunca lo hicieron: pueden ser del
// cliente).
async function copyHierarchy(tableDoc) {
  const workouts = [];
  const splits = (tableDoc.splits || []).map((split) => {
    const clones = (split.workouts || []).filter(Boolean).map((workout) =>
      cloneWorkout(workout, { keepExecutionState: true }),
    );
    workouts.push(...clones);
    return { ...plain(split), _id: newId(), workouts: clones.map((workout) => workout._id) };
  });
  if (workouts.length) await workoutSchema.insertMany(workouts);
  return { splits, pinnedNotes: [] };
}

module.exports = {
  // Trainer viendo la ficha de un cliente concreto — ver comentario de
  // buildAssignedByTrainerMatch. A diferencia de getTables(own=true), no
  // exige que la rutina ya tenga una fase programada.
  async getTablesAssignedByTrainer(clientId, trainerId, page, limit) {
    return tableSchema
      .find(await buildAssignedByTrainerMatch(clientId, trainerId))
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

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

  // Solo nombre y quién la asignó (resúmenes como "Tu plan").
  async findSummary(id) {
    return tableSchema.findById(id).select("name assignedByTrainerId").lean();
  },

  // Ids de las rutinas del cliente que le asignaron estos profesionales.
  async listIdsAssignedBy(clientId, trainerIds) {
    if (!trainerIds?.length) return [];
    return tableSchema.find({ userId: clientId, assignedByTrainerId: { $in: trainerIds } }).select("_id").lean();
  },

  async getTableById(id) {
    return tableSchema.findById(id).exec();
  },

  // MVP-trainers — comprobación de propiedad para activateTableForClient:
  // evita activar una tabla que no es de este cliente (ver auditoría de seguridad de exercises,
  // mismo criterio: nunca confiar en un id de ruta sin verificar dueño).
  async getTableByIdAndUserId(id, userId) {
    return tableSchema.findOne({ _id: id, userId }).exec();
  },

  async copyTable(idUser, idTable) {
    const tableD = await tableSchema.findById(idTable);
    if (!tableD) throw new Error("Table not found");
    const tableDoc = tableD.toObject();

    Object.assign(tableDoc, await copyHierarchy(tableDoc));

    delete tableDoc._id;
    return await tableSchema.create({
      ...tableDoc,
      userId: idUser,
    });
  },

  // MVP-trainers F11: copia una plantilla HACIA un cliente (asignada por su
  // profesional). A diferencia de copyTable, escribe assignedByTrainerId y,
  // deliberadamente, NO toca tableInUse/workoutInUse del cliente — asignar
  // una rutina no la activa sola (ver F11 punto 7.7).
  async copyTableForClient(clientId, idTable, trainerId) {
    const tableD = await tableSchema.findById(idTable);
    if (!tableD) throw new Error("Table not found");
    const tableDoc = tableD.toObject();

    Object.assign(tableDoc, await copyHierarchy(tableDoc));

    delete tableDoc._id;
    return await tableSchema.create({
      ...tableDoc,
      userId: clientId,
      assignedByTrainerId: trainerId,
    });
  },

  async duplicateTable(idUser, idTable) {
    const tableD = await tableSchema.findById(idTable);
    if (!tableD) throw new Error("Table not found");
    const tableDoc = tableD.toObject();

    tableDoc.name = tableDoc.name + " copia";

    Object.assign(tableDoc, await copyHierarchy(tableDoc));

    delete tableDoc._id;
    return await tableSchema.create({
      ...tableDoc,
      userId: idUser,
    });
  },

  async getSearchTables(page, limit, search, isOwn, idUser, defaultOnly = false) {
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
        $addFields: {
          microcyclesCount: { $size: { $ifNull: ["$splits", []] } },
          // Sesiones por microciclo: las del primero.
          workoutsCount: {
            $size: { $ifNull: [{ $arrayElemAt: ["$splits.workouts", 0] }, []] },
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
  },

  async createTable(table) {
    return tableSchema.create(table);
  },

  async createTableToUser(idUser, standardTable) {
    const tableDoc = await tableSchema.create({
      ...standardTable,
      userId: idUser,
    });
    const addTableToUser = {
      $set: { tableInUse: tableDoc._id, tableInUseAt: new Date() },
      $unset: { workoutInUse: "", workoutInUseAt: "" },
    };
    await userSchema.findByIdAndUpdate(idUser, addTableToUser);
    return tableDoc;
  },

  // Solo si la elección apuntaba a esa tabla: borrar una rutina que no está
  // elegida no toca la que sí lo está. Sin elección, manda la fase que cubra
  // hoy (routineAssignments/routine-in-use.js).
  async clearTableInUseIfMatches(userId, tableId) {
    await userSchema.updateOne(
      { _id: userId, tableInUse: tableId },
      { $unset: { tableInUse: "", tableInUseAt: "", workoutInUse: "", workoutInUseAt: "" } },
    );
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

  // "Guardar como plantilla" desde el Planner (2026-09): copia una rutina
  // (de un cliente o propia) a la biblioteca del profesional con SOLO la
  // pauta (ver table-template-copy.js). Mismo resultado que
  // createTableForTrainer: userId=trainerId y sin assignedByTrainerId.
  async copyTableAsTrainerTemplate(trainerId, idTable, name) {
    const tableD = await tableSchema.findById(idTable);
    if (!tableD) throw new Error("Table not found");
    const tableDoc = stripExecutionForTemplate(tableD.toObject());

    Object.assign(tableDoc, await copyHierarchy(tableDoc));

    delete tableDoc._id;
    return tableSchema.create({
      ...tableDoc,
      name,
      userId: trainerId,
    });
  },

  async updateTable(id, name, userId, adminMode = false) {
    const update = { $set: { name: name } };
    const query = adminMode ? { _id: id } : { _id: id, userId: userId };
    const docTable = await tableSchema.findOneAndUpdate(query, update, {
      new: true,
    });
    if (!docTable) throw new Error("Table not found or access denied");
    return { name: docTable.name };
  },

  async deleteTable(idUser, idTable, adminMode = false) {
    const query = adminMode ? { _id: idTable } : { _id: idTable, userId: idUser };
    return await tableSchema.deleteOne(query).exec();
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
      ...sessionsPipeline({ userId: ObjectId(userId) }),
      completedSessionsMatch(fromDate, toDate),
      { $project: { _id: 0, date: "$workoutDocs.date" } },
    ]);
    return rows.map((row) => row.date);
  },

  // Fase 6 Coach Pro — la misma consulta que listCompletedWorkoutDates pero
  // para VARIOS clientes de una vez. Es lo que permite que el evaluador
  // ofrezca "sesiones entrenadas" como métrica de regla sin pasar de ~7
  // consultas por profesional a 7 + N.
  async listCompletedWorkoutDatesForUsers(userIds, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    if (!userIds?.length) return [];
    return tableSchema.aggregate([
      ...sessionsPipeline({ userId: { $in: userIds.map((id) => ObjectId(String(id))) } }),
      completedSessionsMatch(fromDate, toDate),
      { $project: { _id: 0, userId: 1, date: "$workoutDocs.date" } },
    ]);
  },

  // Fase 6 Coach Pro — cada SERIE COMPLETADA de un cliente en un rango, con
  // su fecha, ejercicio, repeticiones y peso. Es la materia prima de
  // volumen, PRs y evolución de cargas (§17).
  //
  // Deliberadamente NO se usa en el evaluador de reglas: una fila por serie
  // significa miles de filas por cliente y trimestre, asequible para UNA
  // ficha abierta y ruinoso multiplicado por toda la cartera. Las reglas
  // usan el recuento de sesiones (listCompletedWorkoutDatesForUsers).
  //
  // `doned` filtra a lo realmente hecho: una serie planificada y no
  // ejecutada no es volumen.
  async listCompletedSetsForUser(userId, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    return tableSchema.aggregate([
      ...sessionsPipeline({ userId: ObjectId(String(userId)) }),
      completedSessionsMatch(fromDate, toDate),
      { $unwind: "$workoutDocs.exercises" },
      {
        $lookup: {
          from: "exercises",
          localField: "workoutDocs.exercises.exercise",
          foreignField: "_id",
          as: "exerciseInfo",
        },
      },
      { $unwind: { path: "$exerciseInfo", preserveNullAndEmptyArrays: true } },
      { $unwind: "$workoutDocs.exercises.sets" },
      { $match: { "workoutDocs.exercises.sets.doned": true } },
      {
        $project: {
          _id: 0,
          date: "$workoutDocs.date",
          workoutId: "$workoutDocs._id",
          // A qué microciclo pertenece la serie (comparar bloque contra
          // bloque sin una segunda consulta) y su tipo (split-schema
          // SPLIT_PURPOSES): en una descarga el volumen baja a propósito.
          splitId: "$splits._id",
          splitName: "$splits.name",
          splitPurpose: "$splits.purpose",
          exerciseName: "$exerciseInfo.name",
          reps: "$workoutDocs.exercises.sets.reps",
          weight: "$workoutDocs.exercises.sets.weight",
          rir: "$workoutDocs.exercises.sets.rir",
          // Músculos con énfasis (muscle-catalog.js), del catálogo: el
          // progreso por grupo cuenta igual que el Análisis del Planner.
          muscles: "$exerciseInfo.muscles",
          isCardio: "$exerciseInfo.isCardio",
          // Pulso de readiness/esfuerzo (1-5) de LA SESIÓN, repetido en cada
          // serie a propósito; buildBlockReadiness deduplica por fecha.
          readinessPre: "$workoutDocs.readinessPre",
          perceivedEffortPost: "$workoutDocs.perceivedEffortPost",
          // Nombre de la sesión ("Día de pierna") para "elegir el workout a
          // ver" (se empareja por nombre, como "comparar por ejercicio").
          workoutName: "$workoutDocs.name",
        },
      },
    ]);
  },

  // Una fila por SESIÓN, con nº total de series y cuántas se marcaron
  // hechas. Alimenta la métrica "Adherencia" del comparador de
  // Entrenamiento: aquí NO se filtra `doned` antes de agrupar — hace falta
  // contar también las series pautadas que no se llegaron a hacer.
  async listSessionAdherenceForUser(userId, fromDate, toDate) {
    const { ObjectId } = require("mongoose").Types;
    return tableSchema.aggregate([
      ...sessionsPipeline({ userId: ObjectId(String(userId)) }),
      completedSessionsMatch(fromDate, toDate),
      { $unwind: "$workoutDocs.exercises" },
      { $unwind: "$workoutDocs.exercises.sets" },
      {
        $group: {
          _id: "$workoutDocs._id",
          date: { $first: "$workoutDocs.date" },
          splitId: { $first: "$splits._id" },
          splitName: { $first: "$splits.name" },
          workoutName: { $first: "$workoutDocs.name" },
          totalSets: { $sum: 1 },
          donedSets: { $sum: { $cond: ["$workoutDocs.exercises.sets.doned", 1, 0] } },
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
      { $lookup: { from: "workouts", localField: "lastSplit.workouts", foreignField: "_id", as: "workoutDocs" } },
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
  // Cuántos microciclos tiene cada rutina (panel admin).
  async countSplitsByTable(tableIds) {
    if (!tableIds?.length) return new Map();
    const rows = await tableSchema.aggregate([
      { $match: { _id: { $in: tableIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
      { $project: { n: { $size: { $ifNull: ["$splits", []] } } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.n]));
  },

  async getSplitsForTables(tableIds) {
    const { ObjectId } = require("mongoose").Types;
    if (!tableIds?.length) return new Map();
    // Los microciclos van embebidos y en orden; el $lookup de sesiones no
    // garantiza el orden de `localField`, así que se reconstruye en JS por
    // _id (día N de la proyección = posición N en splits[].workouts[]).
    const rows = await tableSchema.aggregate([
      { $match: { _id: { $in: tableIds.map((id) => ObjectId(String(id))) } } },
      {
        $project: {
          splits: { _id: 1, workouts: 1 },
          workoutIds: {
            $reduce: {
              input: { $ifNull: ["$splits", []] },
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
      { $project: { splits: 1, workoutDocs: 1 } },
    ]);

    return new Map(
      rows.map((row) => {
        const workoutById = new Map((row.workoutDocs || []).map((w) => [String(w._id), w]));
        const splits = (row.splits || []).map((split) => ({
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
      ...sessionsPipeline({ userId: ObjectId(userId) }),
      { $match: { "workoutDocs.rest": { $ne: true }, "workoutDocs.isPlannedRestDay": { $ne: true } } },
      { $unwind: "$workoutDocs.exercises" },
      { $lookup: { from: "exercises", localField: "workoutDocs.exercises.exercise", foreignField: "_id", as: "exerciseInfo" } },
      { $unwind: { path: "$exerciseInfo", preserveNullAndEmptyArrays: true } },
      { $match: matchExercise },
      {
        $addFields: {
          exerciseType: {
            $cond: [{ $ifNull: ["$exerciseInfo.isIsometric", false] }, "isometric",
              { $cond: [{ $ifNull: ["$exerciseInfo.isCardio", false] }, "cardio", "strength"] }
            ]
          },
          sets: "$workoutDocs.exercises.sets",
        }
      },
      { $unwind: "$sets" },
      { $match: { "sets.doned": true } },
      { $project: { exerciseType: 1, sets: 1 } },
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
