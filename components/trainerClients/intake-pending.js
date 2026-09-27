// PURO — ¿queda pendiente el cuestionario inicial al aceptar una invitación?
//
// `activeWithTrainer` = relaciones "active" que el cliente YA tiene con ese
// mismo profesional (otros scopes). El cuestionario es uno por par:
//   - primer scope con este profesional → pendiente;
//   - ya había otro scope y el cuestionario se envió → no se repite;
//   - ya había otro scope pero el cuestionario sigue sin enviar → pendiente
//     también en el nuevo (si no, al rellenarlo faltarían los campos del
//     scope nuevo, p. ej. dietaryFlags de nutrición).
function intakePendingOnAccept(activeWithTrainer) {
  if (!activeWithTrainer.length) return true;
  return activeWithTrainer.some((relation) => relation.intakePending === true);
}

module.exports = { intakePendingOnAccept };
