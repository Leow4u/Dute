/**
 * O banco Firestore do RH (docs/plataforma/fase-8-rh.md): um banco à parte,
 * `rh`, no mesmo projeto, fechado ao navegador (firestore-rh.rules). O
 * `users` e o `collaborators` continuam no banco padrão; o que é do RH
 * (registros, recibos e eventos) fica neste.
 *
 * Uma transação do Firestore vale para um banco só: a gravação do RH confere
 * o banco padrão antes e grava tudo dela numa transação do banco `rh`.
 */
export const RH_DATABASE = "rh";
