function getNumericOrder(set, fallback) {
  const order = Number(set?.order);
  return Number.isFinite(order) ? order : fallback;
}

function normalizeSetsOrder(sets = []) {
  return [...sets]
    .filter(Boolean)
    .map((set, index) => ({ set, index }))
    .sort((a, b) => {
      const orderDiff =
        getNumericOrder(a.set, Number.MAX_SAFE_INTEGER) -
        getNumericOrder(b.set, Number.MAX_SAFE_INTEGER);

      if (orderDiff !== 0) return orderDiff;
      return a.index - b.index;
    })
    .map(({ set }, index) => {
      set.order = index;
      return set;
    });
}

module.exports = {
  normalizeSetsOrder,
};
