const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function isLocalHost(value = "") {
  return value.includes("localhost") || value.includes("127.0.0.1");
}

function withLocalPort(host, port) {
  if (!port || /:\d+$/.test(host)) return host;
  return `${host}:${port}`;
}

function buildMongoUri() {
  const explicitUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (explicitUri) return explicitUri;

  const host = process.env.MONGODB_HOST;
  const port = process.env.MONGODB_PORT;
  const cluster = process.env.MONGODB_CLUSTER;
  const dbName = process.env.MONGODB_DB;
  const user = process.env.MONGODB_USER;
  const pass = process.env.MONGODB_PASS;

  if (!dbName) {
    throw new Error("Set MONGODB_DB, or provide MONGODB_URI/MONGO_URI.");
  }

  if (host) {
    if (host.startsWith("mongodb://") || host.startsWith("mongodb+srv://")) {
      return host;
    }

    const localHost = withLocalPort(host, port);
    const auth =
      user && pass
        ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
        : "";
    return `mongodb://${auth}${localHost}/${dbName}`;
  }

  if (!cluster) {
    throw new Error(
      "Set MONGODB_HOST/MONGODB_DB, MONGODB_CLUSTER/MONGODB_DB, or provide MONGODB_URI/MONGO_URI.",
    );
  }

  if (cluster.startsWith("mongodb://") || cluster.startsWith("mongodb+srv://")) {
    return cluster;
  }

  if (isLocalHost(cluster)) {
    return `mongodb://${withLocalPort(cluster, port)}/${dbName}`;
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

function redactMongoUri(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

module.exports = {
  buildMongoUri,
  redactMongoUri,
};
