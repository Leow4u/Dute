import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * A nova tentativa que a pessoa pede (o "Tentar de novo" da demora, a falha
 * da seção): relê as leituras das chaves dadas. O react-query não recomeça a
 * leitura sem dado que ainda lê: o `refetch` só se juntaria à leitura presa,
 * e a demora continuaria. Essas são canceladas e lidas de novo; as outras
 * (com dado, ou paradas na falha) só relêem. Como a linha de estado faz com as
 * listas (carregamento v2, parte 7b; parte 13e).
 */
export async function relerDoZero(cliente: QueryClient, chaves: readonly QueryKey[]): Promise<void> {
  await Promise.all(
    chaves.map((queryKey) =>
      cliente.cancelQueries({
        queryKey,
        predicate: (consulta) => consulta.state.data === undefined && consulta.state.fetchStatus === "fetching",
      }),
    ),
  );
  await Promise.all(chaves.map((queryKey) => cliente.refetchQueries({ queryKey, type: "active" })));
}
