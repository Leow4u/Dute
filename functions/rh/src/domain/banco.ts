/**
 * O banco Firestore do RH (docs/plataforma/fase-8-rh.md): um banco à parte,
 * `dute-rh`, no mesmo projeto, fechado ao navegador (firestore-rh.rules). O
 * `users` e o `collaborators` continuam no banco padrão; o que é do RH
 * (registros, recibos e eventos) fica neste.
 *
 * Uma transação do Firestore vale para um banco só: a gravação do RH confere
 * o banco padrão antes e grava tudo dela numa transação do banco `dute-rh`.
 *
 * O nome se repete no tools/banco_rh.sh e na zeragem
 * (tools/full_reset_btg.py), travados em tools/test_banco_rh.py. O Firestore
 * exige de 4 a 63 caracteres: `rh` foi recusado em 24/10/2026.
 */
export const RH_DATABASE = "dute-rh";
