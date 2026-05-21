const LIMITS = {
  text: {
    shortNameMin: 2,
    shortNameMax: 60,
    personNameMin: 1,
    personNameMax: 50,
    lastnameMax: 80,
    productNameMax: 100,
    brandMax: 60,
    descriptionMax: 500,
    noteMax: 500,
    ingredientsMax: 1000,
    allergensMax: 300,
    emailMax: 254,
    barcodeMax: 32,
  },
  profile: {
    weightMin: 30,
    weightMax: 300,
    heightMin: 70,
    heightMax: 300,
    kcalMin: 800,
    kcalMax: 8000,
    macroGramsMin: 0,
    macroGramsMax: 1000,
    objectiveKcalMin: -2000,
    objectiveKcalMax: 2000,
  },
  workout: {
    weightMin: 0,
    weightMax: 1000,
    repsMin: 0,
    repsMax: 500,
    velocityMin: 0,
    velocityMax: 80,
    minutesMin: 0,
    minutesMax: 999,
    secondsMin: 0,
    secondsMax: 59,
    restPauseMin: 0,
    restPauseMax: 600,
  },
  nutrition: {
    quantityMin: 0,
    quantityMax: 10000,
    kcal100gMin: 0,
    kcal100gMax: 900,
    grams100gMin: 0,
    grams100gMax: 100,
    storedMicroMin: 0,
    storedMicroMax: 100,
  },
};

const trimString = (value) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
    : value;

const stringField = (maxLength, required = false, minlength = 0) => ({
  type: String,
  required,
  minlength,
  maxlength: maxLength,
  set: trimString,
});

const numberField = (min, max) => ({
  type: Number,
  min,
  max,
});

const stringArrayField = (maxLength) => ({
  type: [String],
  default: undefined,
  validate: {
    validator(values) {
      return (values || []).every(
        (value) => typeof value === "string" && value.length <= maxLength,
      );
    },
    message: `Cada valor debe tener ${maxLength} caracteres o menos`,
  },
  set(values) {
    if (!Array.isArray(values)) return values;
    return values.map(trimString).filter(Boolean);
  },
});

const applyRunValidators = (schema) => {
  schema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
    this.setOptions({ runValidators: true });
    next();
  });
};

module.exports = {
  LIMITS,
  stringField,
  numberField,
  stringArrayField,
  applyRunValidators,
};
