function buildMongoUri() {
  const explicitUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (explicitUri) return explicitUri;

  const cluster = process.env.MONGODB_CLUSTER;
  const dbName = process.env.MONGODB_DB;
  const user = process.env.MONGODB_USER;
  const pass = process.env.MONGODB_PASS;

  if (!cluster || !dbName) {
    throw new Error(
      "Set MONGODB_CLUSTER and MONGODB_DB, or provide MONGODB_URI/MONGO_URI.",
    );
  }

  if (cluster.startsWith("mongodb://") || cluster.startsWith("mongodb+srv://")) {
    return cluster;
  }

  if (cluster.includes("localhost") || cluster.includes("127.0.0.1")) {
    return `mongodb://${cluster}/${dbName}`;
  }

  if (!user || !pass) {
    throw new Error("Set MONGODB_USER and MONGODB_PASS for Atlas connections.");
  }

  const atlasHost = cluster.includes(".mongodb.net")
    ? cluster
    : `${cluster}.mongodb.net`;

  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(
    pass,
  )}@${atlasHost}/${dbName}`;
}

module.exports = {
  buildMongoUri,
};
