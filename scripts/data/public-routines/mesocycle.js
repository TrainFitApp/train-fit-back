// El bloque de 4 semanas de todas las rutinas públicas: un microciclo por
// semana, con la misma sesión en cada fila y la pauta que cambia según la
// semana (scripts/seed-public-routines.js#prescribeSets).
//
//   rirDelta              se suma al RIR de la semana 1 de cada ejercicio
//                         (nunca baja de 1 en los básicos ni de 0 en los de
//                         aislamiento)
//   failLastIsolationSet  la última serie de los de aislamiento, al fallo
//   deload                la mitad de series (redondeando hacia arriba) a
//                         RIR 4; los bloques mantienen sus rondas
//
// `objective` es lo que lee el cliente en la cabecera del microciclo (máx.
// 300 caracteres).

const DELOAD_RIR = 4;

module.exports = Object.freeze({
  DELOAD_RIR,
  WEEKS: Object.freeze([
    {
      name: "Semana 1",
      purpose: "accumulation",
      rirDelta: 0,
      objective:
        "Toma de contacto: elige cargas que te dejen en reserva las repeticiones indicadas (RIR). Apunta los pesos: son tu punto de partida.",
    },
    {
      name: "Semana 2",
      purpose: "accumulation",
      rirDelta: -1,
      objective:
        "Sube un poco la carga o haz una repetición más con la misma técnica: te queda una repetición menos en reserva.",
    },
    {
      name: "Semana 3",
      purpose: "intensification",
      rirDelta: -2,
      failLastIsolationSet: true,
      objective:
        "La semana más exigente: los básicos cerca del fallo y la última serie de los ejercicios de aislamiento, al fallo con buena técnica.",
    },
    {
      name: "Semana 4",
      purpose: "deload",
      deload: true,
      objective:
        "Descarga: la mitad de series, lejos del fallo y con las cargas de la semana 1. Después repite el bloque partiendo de los pesos de la semana 3.",
    },
  ]),
});
