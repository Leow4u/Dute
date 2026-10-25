"""Espera os índices compostos do firestore.indexes.json ficarem prontos.

Chamado pelo job `regras` do .github/workflows/publicar.yml, depois do
`firebase deploy --only firestore,storage`. O deploy pede o índice novo e volta
na hora; o índice leva minutos para ser construído, e a consulta que depende
dele falha com "requires an index" até lá. Na tela, o roteador do navegador
(readPaged) cai na leitura das mais recentes e esconde o resto sem aviso. As
functions e o frontend só sobem com os índices prontos: regras e índices antes,
nunca depois.

Lê pela API do Firestore (v1) os índices compostos do banco padrão e espera
cada um do arquivo existir no projeto com o estado READY. Sai com 0 quando
estão todos prontos; com 1 se algum precisa de reparo (NEEDS_REPAIR), se algum
do arquivo não aparece no projeto ou se o prazo (PRAZO_MINUTOS, 30 por padrão)
acaba.

Uso, da raiz do repositório: python3 tools/esperar_indices.py <projeto>, com
ACCESS_TOKEN (no CI, o do google-github-actions/auth).
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

ARQUIVO = Path(__file__).resolve().parent.parent / "firestore.indexes.json"

Chave = tuple[str, str, tuple[tuple[str, str], ...]]


class ErroTransitorio(Exception):
    """Falha de rede ou 5xx/429 da API: tenta de novo na próxima rodada."""


def chave(colecao: str, escopo: str, campos: list[dict[str, Any]]) -> Chave:
    """O índice como comparável: a API lista o __name__ do fim, que o arquivo não escreve."""
    pares = [(str(campo.get("fieldPath")), str(campo.get("order") or campo.get("arrayConfig") or "")) for campo in campos]
    if pares and pares[-1][0] == "__name__":
        pares = pares[:-1]
    return colecao, escopo, tuple(pares)


def descrever(indice: Chave) -> str:
    colecao, escopo, campos = indice
    grupo = "" if escopo == "COLLECTION" else f" [{escopo}]"
    return f"{colecao}{grupo} ({', '.join(f'{campo} {ordem}' for campo, ordem in campos)})"


def indices_do_arquivo(caminho: Path = ARQUIVO) -> list[Chave]:
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    return [chave(indice["collectionGroup"], indice.get("queryScope", "COLLECTION"), indice["fields"]) for indice in dados.get("indexes", [])]


def chave_da_api(indice: dict[str, Any]) -> Chave:
    # name: projects/<p>/databases/(default)/collectionGroups/<colecao>/indexes/<id>
    colecao = str(indice.get("name", "")).split("/collectionGroups/")[-1].split("/")[0]
    return chave(colecao, str(indice.get("queryScope", "COLLECTION")), list(indice.get("fields", [])))


class Firestore:
    def __init__(self, projeto: str, token: str, base: str = "https://firestore.googleapis.com/v1"):
        self.projeto = projeto
        self.token = token
        self.base = base.rstrip("/")

    def _get(self, caminho: str) -> Any:
        pedido = urllib.request.Request(
            f"{self.base}/{caminho}",
            headers={"Authorization": f"Bearer {self.token}", "x-goog-user-project": self.projeto},
        )
        try:
            with urllib.request.urlopen(pedido, timeout=30) as resposta:
                return json.load(resposta)
        except urllib.error.HTTPError as erro:
            if erro.code >= 500 or erro.code == 429:
                raise ErroTransitorio(f"a API do Firestore respondeu {erro.code}") from erro
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as erro:
            raise ErroTransitorio(str(erro)) from erro

    def indices(self) -> list[dict[str, Any]]:
        """Os índices compostos do banco padrão, de todas as coleções."""
        lidos: list[dict[str, Any]] = []
        pagina = ""
        while True:
            consulta = urllib.parse.urlencode({"pageSize": 200, **({"pageToken": pagina} if pagina else {})})
            resposta = self._get(f"projects/{self.projeto}/databases/(default)/collectionGroups/-/indexes?{consulta}")
            lidos.extend(resposta.get("indexes", []))
            pagina = resposta.get("nextPageToken", "")
            if not pagina:
                return lidos


def decidir(esperados: list[Chave], da_api: list[dict[str, Any]]) -> tuple[str, list[str]]:
    """Uma rodada: "pronto", "esperar" ou "reparo", com os índices que ainda não estão READY."""
    estados = {chave_da_api(indice): str(indice.get("state", "")) for indice in da_api}
    reparo = [descrever(indice) for indice in esperados if estados.get(indice) == "NEEDS_REPAIR"]
    if reparo:
        return "reparo", reparo
    # O que ainda não aparece na lista também espera: o pedido do deploy pode
    # levar alguns segundos para surgir.
    pendentes = [f"{descrever(indice)}: {estados.get(indice) or 'não aparece no projeto'}" for indice in esperados if estados.get(indice) != "READY"]
    return ("esperar", pendentes) if pendentes else ("pronto", [])


def esperar(
    api: Any,
    esperados: list[Chave],
    prazo_s: float,
    intervalo_s: float,
    dormir: Callable[[float], None] = time.sleep,
    relogio: Callable[[], float] = time.monotonic,
    log: Callable[[str], None] = print,
) -> tuple[str, list[str]]:
    """Repete decidir() até sair de "esperar" ou o prazo acabar ("sem_resposta")."""
    inicio = relogio()
    pendentes: list[str] = []
    ultimo: list[str] | None = None
    while True:
        try:
            decisao, pendentes = decidir(esperados, api.indices())
        except ErroTransitorio as erro:
            log(f"A API do Firestore falhou ({erro}); tento de novo.")
        else:
            if decisao != "esperar":
                return decisao, pendentes
            if pendentes != ultimo:
                log(f"{len(pendentes)} índice(s) ainda não pronto(s):")
                for pendente in pendentes:
                    log(f"  {pendente}")
                ultimo = pendentes
        if relogio() - inicio >= prazo_s:
            return "sem_resposta", pendentes
        dormir(intervalo_s)


def main(argv: list[str] | None = None, env: dict[str, str] | None = None, api: Any = None, **opcoes: Any) -> int:
    argv = sys.argv[1:] if argv is None else argv
    env = dict(os.environ) if env is None else env
    if len(argv) != 1:
        print("uso: python3 tools/esperar_indices.py <projeto>")
        return 2
    projeto = argv[0]
    prazo_min = int(env.get("PRAZO_MINUTOS", "30"))
    esperados = indices_do_arquivo()
    if api is None:
        api = Firestore(projeto, env["ACCESS_TOKEN"])

    try:
        decisao, pendentes = esperar(api, esperados, prazo_s=prazo_min * 60, intervalo_s=15, **opcoes)
    except urllib.error.HTTPError as erro:
        print(f"::error::A API do Firestore respondeu {erro.code} ao listar os índices de {projeto}. A conta do job precisa de datastore.indexes.list (roles/datastore.indexAdmin).")
        return 1

    if decisao == "pronto":
        print(f"Os {len(esperados)} índices do firestore.indexes.json estão prontos em {projeto}.")
        return 0
    if decisao == "reparo":
        print(f"::error::Índice que precisa de reparo em {projeto}; nada mais sobe. Recrie o índice (Firestore › Índices) e rode a publicação de novo.")
    else:
        print(f"::error::Os índices não ficaram prontos em {prazo_min} min em {projeto}; nada mais sobe. Confira em Firestore › Índices e rode a publicação de novo quando terminarem.")
    for pendente in pendentes:
        print(f"  {pendente}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
