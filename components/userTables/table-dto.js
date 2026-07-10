const single = (resource, authUser) => ({
  id: resource._id,
  name: resource.name,
});

const multiple = (resources, authUser) => resources.map((resource) => single(resource, authUser));

module.exports = {
  single,
  multiple,
};
