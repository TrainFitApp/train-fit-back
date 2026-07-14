const single = (resource, authUser) => ({
  id: resource._id,
  name: resource.name,
  pinnedNote: resource.pinnedNote || null,
});

const multiple = (resources, authUser) => resources.map((resource) => single(resource, authUser));

module.exports = {
  single,
  multiple,
};
