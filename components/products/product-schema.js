const mongoose = require("mongoose");
const { buildSearchFields } = require("../util/search-index");
const { productValueSchemaFields } = require("../util/nutrient-fields");
const Schema = mongoose.Schema;

const ProductSchema = Schema({
  code: { type: String, trim: true, maxlength: 100 },
  name: { type: String, trim: true, maxlength: 300 },
  brand: { type: String, trim: true, maxlength: 200 },
  // Campos derivados para la búsqueda (components/util/search-index.js).
  // `searchTokens` sustituye a los antiguos namePrefixes/brandPrefixes: ver
  // ahí por qué guardar todos los prefijos no escalaba.
  nameNormalized: String,
  brandNormalized: String,
  searchTokens: [String],

  // Valores por 100 g, ingredientes, alérgenos y aptitudes: catálogo único
  // en util/nutrient-fields.js (lo comparte CustomProduct).
  ...productValueSchemaFields(),

  // Product information
  servingUnit: String,

  // Ración
  productQuantity: Number,
  servingQuantity: Number,
  verified: Boolean,

  // Owner: if set, this product was created by the user (replaces OwnProduct)
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
});

// ─── INDEXES ───────────────────────────────────────────────────────────
// Los índices de products los gestiona scripts/rebuild-search-indexes.js.
// Ejecutar:  npm run rebuild:search-indexes
// NO declarar índices aquí — el script es la fuente única de verdad.
// ───────────────────────────────────────────────────────────────────────

// ─── Campos derivados de búsqueda ──────────────────────────────────────
// Se calculan en el schema, no en el DAO, porque un producto se crea desde
// varios sitios: /api/products, el alta en línea al añadir un alimento a una
// comida (customProducts/custom-product-dao.js) y los scripts de semilla. Si
// alguno se olvida de rellenarlos, ese producto no aparece NUNCA en la
// búsqueda — y eso es exactamente lo que pasaba con los productos creados
// desde la app y con cualquier producto al que se le editaran solo las
// macros (el $unset genérico de updateProduct se los llevaba por delante).

ProductSchema.pre("save", function syncSearchFieldsOnSave(next) {
  if (this.isModified("name") || this.isModified("brand") || !this.nameNormalized) {
    Object.assign(this, buildSearchFields({ name: this.name, brand: this.brand }));
  }
  next();
});

async function syncSearchFieldsOnUpdate() {
  const update = this.getUpdate() || {};
  if (Array.isArray(update)) return; // pipeline de agregación: no lo usamos

  const set = update.$set || {};
  const unset = update.$unset || {};
  const touchesName =
    Object.prototype.hasOwnProperty.call(set, "name") ||
    Object.prototype.hasOwnProperty.call(update, "name") ||
    Object.prototype.hasOwnProperty.call(unset, "name");
  const touchesBrand =
    Object.prototype.hasOwnProperty.call(set, "brand") ||
    Object.prototype.hasOwnProperty.call(update, "brand") ||
    Object.prototype.hasOwnProperty.call(unset, "brand");

  if (!touchesName && !touchesBrand) return;

  const pick = (field) => {
    if (Object.prototype.hasOwnProperty.call(set, field)) return set[field];
    if (Object.prototype.hasOwnProperty.call(update, field)) return update[field];
    if (Object.prototype.hasOwnProperty.call(unset, field)) return "";
    return undefined;
  };

  // `searchTokens` mezcla nombre y marca: si solo cambia uno, hace falta leer
  // el otro del documento actual.
  let name = pick("name");
  let brand = pick("brand");

  if (name === undefined || brand === undefined) {
    const current = await this.model
      .findOne(this.getQuery())
      .select("name brand")
      .lean();
    if (name === undefined) name = current?.name;
    if (brand === undefined) brand = current?.brand;
  }

  const derived = buildSearchFields({ name, brand });
  const nextUpdate = { ...update, $set: { ...set, ...derived } };

  if (nextUpdate.$unset) {
    nextUpdate.$unset = { ...nextUpdate.$unset };
    Object.keys(derived).forEach((field) => delete nextUpdate.$unset[field]);
    if (!Object.keys(nextUpdate.$unset).length) delete nextUpdate.$unset;
  }

  this.setUpdate(nextUpdate);
}

ProductSchema.pre("findOneAndUpdate", syncSearchFieldsOnUpdate);
ProductSchema.pre("updateOne", syncSearchFieldsOnUpdate);

// ─── Borrado: lo que queda de él en los platos ─────────────────────────
// Un producto borrado sale de los favoritos de quien lo tuviera, y cada
// alimento que lo usaba (diarios, recetas, comidas guardadas, plantillas) se
// convierte en adición rápida con sus valores: ver product-detach.js.
async function cascadeDeleteProducts(products) {
  if (!products.length) return;
  const productIds = products.map((product) => product._id);

  await require("../favorites/favorites-dao").removeEverywhere("products", productIds);

  await require("./product-detach").detachProductReferences(products);
}

// ─── Hooks ─────────────────────────────────────────────────────────────
const handleDeleteOne = async function (next) {
  try {
    const query = this.getQuery();
    const product = await this.model.findOne(query).lean();
    if (!product) return next();
    await cascadeDeleteProducts([product]);
    next();
  } catch (error) {
    next(error);
  }
};

const handleDeleteMany = async function (next) {
  try {
    const query = this.getQuery();
    const products = await this.model.find(query).lean();
    if (!products.length) return next();
    await cascadeDeleteProducts(products);
    next();
  } catch (error) {
    next(error);
  }
};

ProductSchema.pre("deleteOne", handleDeleteOne);
ProductSchema.pre("findOneAndDelete", handleDeleteOne);
ProductSchema.pre("findOneAndRemove", handleDeleteOne);
ProductSchema.pre("deleteMany", handleDeleteMany);

// Borrado de cuenta: los productos van los últimos, cuando ya no existen el
// diario, las recetas ni las plantillas de la propia cuenta; el hook de
// arriba deja como adición rápida los que siguen en platos de otros.
const { accountCascade, STAGE } = require("../util/account-cascade");
ProductSchema.plugin(accountCascade, { owners: ["userId"], stage: STAGE.products });

module.exports = mongoose.model("Product", ProductSchema);
