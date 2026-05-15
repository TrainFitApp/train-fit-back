const { MongoClient } = require("mongodb");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

async function main() {
  const commit = process.argv.includes("--commit");
  const uri = buildMongoUri();
  const client = new MongoClient(uri);

  await client.connect();
  const db = client.db();

  const users = db.collection("users");
  const unsetLegacyFields = {
    $unset: {
      refreshToken: "",
      previousRefreshToken: "",
      tokenRotationTimestamp: "",
      auth: "",
    },
  };

  if (!commit) {
    const usersWithLegacyAuth = await users.countDocuments({
      $or: [
        { refreshToken: { $exists: true } },
        { previousRefreshToken: { $exists: true } },
        { tokenRotationTimestamp: { $exists: true } },
        { auth: { $exists: true } },
      ],
    });
    const authSessions = await db.collection("authsessions").countDocuments();
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          mongoUri: redactMongoUri(uri),
          usersWithLegacyAuth,
          authSessions,
          next: "Run with --commit to clear user auth fields and drop authsessions.",
        },
        null,
        2
      )
    );
    await client.close();
    return;
  }

  const userResult = await users.updateMany({}, unsetLegacyFields);
  let droppedAuthSessions = false;
  try {
    await db.collection("authsessions").drop();
    droppedAuthSessions = true;
  } catch (error) {
    if (error?.codeName !== "NamespaceNotFound") {
      throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        mongoUri: redactMongoUri(uri),
        usersMatched: userResult.matchedCount,
        usersModified: userResult.modifiedCount,
        droppedAuthSessions,
      },
      null,
      2
    )
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
