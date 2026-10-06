// Una persona al otro lado del par (el cliente visto por el profesional o el
// profesional visto por el cliente) con los scopes que tiene en curso.
const summary = (entry) => ({
  user: entry.user
    ? { _id: entry.user._id, name: entry.user.name, lastname: entry.user.lastname, email: entry.user.email }
    : null,
  scopes: entry.scopes,
});

module.exports = {
  summary,
  summaries: (entries) => entries.map(summary),
};
