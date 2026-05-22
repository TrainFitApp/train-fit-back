const axios = require("axios");
const exerciseModel = require("../exercises/exercise-model");

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

function buildSystemPrompt(exercises) {
  const exercisesJson = exercises.map((e) => ({
    _id: e._id.toString(),
    name: e.name,
    muscleGroups1: e.muscleGroups1 || [],
    muscleGroups2: e.muscleGroups2 || [],
    category: e.category || [],
    equipment: e.equipment || [],
    isCardio: e.isCardio || false,
  }));

  return `Eres un experto en datos de entrenamiento. Conviertes tablas de Excel/CSV al modelo de datos TrainFit.

## CONTEXTO - Ejercicios existentes en la base de datos:
${JSON.stringify(exercisesJson, null, 2)}

## REGLAS DE CONVERSIÓN:
1. **RPE a RIR**: RIR = 10 - RPE (RPE 10 → RIR 0, RPE 9 → RIR 1, etc.)
2. **expectedReps**: array de 2 números [min, max]. Si solo hay un valor, duplicarlo [val, val].
3. **expectedRir**: array de 2 números [min, max]. Si es "FALLO" o "failure", usar [-1].
4. **weight**: número (kg). Si hay múltiples pesos en las series, usa el primero como referencia.
5. **drop** (Dropset): true si la fila indica "DS", "drop", "dropset".
6. **restPause** (Rest-Pause): número en segundos. Si indica "RP 20s" → 20, "RP 1min" → 60. Si no hay RP, poner null.
7. **Cardio**: si el ejercicio es de tipo cardio (correr, bici, etc.), usar expectedMin/expectedSec en vez de expectedReps/expectedRir.
8. **Coincidencia de ejercicios**: para cada ejercicio en los datos, busca el más parecido en la lista de ejercicios existentes. Si la coincidencia es >80%, devuelve su _id en matchedExerciseId. Si no hay coincidencia buena, pon matchedExerciseId: null y shouldCreate: true, e INFIERE los datos del ejercicio (muscleGroups, category, equipment) en exerciseData.
9. **Ignorar filas irrelevantes**: si una fila no se puede interpretar como ejercicio/set, ignórala.
10. **Estructura**: si hay múltiples hojas/sheets, infiere si son splits diferentes. Si hay secciones dentro de una hoja, infiere si son workouts diferentes.

## FORMATO DE SALIDA (solo JSON, sin markdown):
{
  "name": "nombre inferido de la rutina",
  "splits": [
    {
      "name": "nombre del split/microciclo",
      "workouts": [
        {
          "name": "nombre del entrenamiento/día",
          "notes": "notas si las hay",
          "exercises": [
            {
              "matchedExerciseId": "id_existente o null",
              "shouldCreate": true/false,
              "name": "nombre del ejercicio",
              "notes": "notas del ejercicio si las hay",
              "exerciseData": {
                "name": "nombre",
                "muscleGroups1": ["grupo1"],
                "muscleGroups2": ["grupo2"],
                "category": ["categoria"],
                "equipment": ["equipo"],
                "isCardio": false
              },
              "sets": [
                {
                  "expectedReps": [8, 12],
                  "expectedRir": [1, 2],
                  "weight": 80,
                  "drop": false,
                  "restPause": null,
                  "expectedMin": null,
                  "expectedSec": null
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}`;
}

function buildUserPrompt(sheets, fileName) {
  return `Nombre del archivo: ${fileName || "desconocido"}

## Datos del Excel:
${JSON.stringify(sheets, null, 2)}`;
}

async function interpretExcel(sheets, fileName) {
  try {
    const exercises = await exerciseModel.getExercises(0, 10000);
    const systemPrompt = buildSystemPrompt(exercises);
    const userPrompt = buildUserPrompt(sheets, fileName);

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPSEEK_API_KEY no configurada");
    }

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 16000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Respuesta vacía de DeepSeek");
    }

    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Error parseando respuesta de DeepSeek: ${error.message}`);
    }
    if (error.response?.data?.error) {
      throw new Error(
        `Error de DeepSeek API: ${error.response.data.error.message || JSON.stringify(error.response.data.error)}`
      );
    }
    throw error;
  }
}

module.exports = {
  interpretExcel,
};
