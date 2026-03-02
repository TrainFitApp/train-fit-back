const aggregateFilter = async (docs, node) => {
  if (docs.length > 0 && docs[0][node]) {
    docs = docs[0][node];
  }

  return docs;
};

module.exports = { aggregateFilter };
