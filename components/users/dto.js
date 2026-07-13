const single = async (resource, authUser) => ({
  _id: resource._id,
  name: resource.name,
  lastname: resource.lastname,
  email: resource.email,
  roles: resource.roles,
  activity: resource.activity,
  sex: resource.sex,
  objetive: resource.objetive,
  steps: resource.steps,
  training: resource.training,
  height: resource.height,
  weight: resource.weight,
  goalInUse: resource.goalInUse,
  workoutInUse: resource.workoutInUse,
  dietInUse: resource.dietInUse,
  tableInUse: resource.tableInUse,
  tables: resource.tables,
  archivedProducts: resource.archivedProducts,
  archivedExercises: resource.archivedExercises,
  archivedRecipes: resource.archivedRecipes,
  birth: resource.birth,
  hash: resource.hash,
  archivedTables: resource.archivedTables,
  personalAds: resource.personalAds,
  lastLogin: resource.lastLogin,
  premium: resource.premium,
  theme: resource.theme,
  provider: resource.provider,
});

const multiple = (resources, authUser) =>
  resources.map((resource) => single(resource, authUser));

module.exports = {
  single,
  multiple,
};
