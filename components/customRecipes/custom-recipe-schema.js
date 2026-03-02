const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// IMPORTANTE: Este schema representa una INSTANCIA de receta en una MEAL
// Con SOLO los cambios respecto a la receta original (DataRecipe)
const CustomRecipeInstanceSchema = Schema(
  {
    // REFERENCIA a la DataRecipe (plantilla)
    dataRecipe: {
      type: Schema.Types.ObjectId,
      ref: "DataRecipe",
      autopopulate: true,
      required: true,
    },

    // Cantidad de la receta que se añade a la meal (en gramos)
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },

    // OVERRIDES: Cambios respecto a los CustomProducts originales
    customProductsOverrides: [
      {
        // ID del CustomProduct original en la Recipe
        customProductId: {
          type: Schema.Types.ObjectId,
          required: true,
        },
        // Nueva cantidad (null/undefined = usar original)
        quantity: {
          type: Number,
          default: null,
        },
        // true = excluir este ingrediente
        removed: {
          type: Boolean,
          default: false,
        },
      },
    ],

    // Ingredientes adicionales específicos de esta instancia
    additionalCustomProducts: [
      {
        // Cantidad del nuevo ingrediente
        quantity: {
          type: Number,
          required: true,
        },
        // Referencia a product estándar
        product: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          autopopulate: true,
        },
        // Nota: Los macros se leen en tiempo real desde el producto referenciado.
        // No se copian aquí para ahorrar espacio en BD
      },
    ],
  },
  {
    timestamps: true, // createdAt, updatedAt
    strict: true,
  },
);

CustomRecipeInstanceSchema.plugin(require("mongoose-autopopulate"));

const handleDeleteOne = async function (next) {
  try {
    const query = this.getQuery();
    const instance = await this.model.findOne(query, "dataRecipe").lean();

    if (instance?.dataRecipe) {
      const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");
      // Eliminar el DataRecipe si ya no lo usa ninguna otra instancia
      const remaining = await this.model.countDocuments({
        dataRecipe: instance.dataRecipe,
        _id: { $ne: instance._id },
      });

      if (remaining === 0) {
        await dataRecipeSchema.deleteOne({ _id: instance.dataRecipe });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

CustomRecipeInstanceSchema.pre("deleteOne", handleDeleteOne);
CustomRecipeInstanceSchema.pre("findOneAndDelete", handleDeleteOne);
CustomRecipeInstanceSchema.pre("findOneAndRemove", handleDeleteOne);

CustomRecipeInstanceSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const instances = await this.model.find(filter, "dataRecipe").lean();
    const dataRecipeIds = [
      ...new Set(
        instances.map((i) => i.dataRecipe?.toString?.()).filter(Boolean),
      ),
    ];

    if (dataRecipeIds.length > 0) {
      const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");

      for (const dataRecipeId of dataRecipeIds) {
        const remaining = await this.model.countDocuments({
          dataRecipe: dataRecipeId,
          _id: { $nin: instances.map((i) => i._id) },
        });

        if (remaining === 0) {
          await dataRecipeSchema.deleteOne({ _id: dataRecipeId });
        }
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Nota: Este modelo reemplaza al anterior "CustomRecipe"
// El nombre sigue siendo "CustomRecipe" para compatibilidad con existing data
module.exports = mongoose.model("CustomRecipe", CustomRecipeInstanceSchema);
