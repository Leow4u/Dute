"""Espera o CI do commit ficar verde antes de publicar na homologação.

Chamado pelo primeiro job do .github/workflows/homologacao.yml, que já está na
fila "publicar-homologacao". A fila é do workflow inteiro, em ordem de push;
por isso os testes rodam no ci.yml, em paralelo, e aqui só se espera o
resultado deles.

Até 22/10/2026 a fila era do job de publicação do ci.yml, que só entrava nela
quando os testes do commit acabavam. Os testes de pushes seguidos terminam fora
de ordem (a instalação do Chromium leva de 20 s a 12 min), e o GitHub mantém só
o último a chegar na espera: o #172 entrou depois do #170, tirou o #170 da fila
e, quando chegou a vez dele, não publicou porque o HEAD da main era o #170. A
homologação ficou dois PRs atrás até alguém rodar o #170 de novo à mão.

Resultado (em $GITHUB_OUTPUT, publicar=true|false):
- CI verde e o commit ainda é o HEAD da main: publicar=true.
- A main andou: publicar=false e sai verde. O push mais novo tem a própria
  execução na fila, que roda depois desta.
- CI vermelho ou cancelado, ou sem resposta no prazo: sai vermelho, nada sobe.

Rodar da raiz do repositório, com GITHUB_REPOSITORY, GITHUB_SHA e GITHUB_TOKEN
(permissões actions: read e contents: read).
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable


class ErroTransitorio(Exception):
    """Falha de rede ou 5xx/429 da API: tenta de novo na próxima rodada."""


class GitHub:
    def __init__(self, repo: str, token: str, base: str = "https://api.github.com", workflow: str = "ci.yml"):
        self.repo = repo
        self.token = token
        self.base = base.rstrip("/")
        self.workflow = workflow

    def _get(self, caminho: str) -> Any:
        pedido = urllib.request.Request(
            f"{self.base}{caminho}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with urllib.request.urlopen(pedido, timeout=30) as resposta:
                return json.load(resposta)
        except urllib.error.HTTPError as erro:
            if erro.code >= 500 or erro.code == 429:
                raise ErroTransitorio(f"GitHub respondeu {erro.code}") from erro
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as erro:
            raise ErroTransitorio(str(erro)) from erro

    def head_main(self) -> str:
        return self._get(f"/repos/{self.repo}/git/ref/heads/main")["object"]["sha"]

    def execucoes_ci(self, sha: str) -> list[dict[str, Any]]:
        consulta = urllib.parse.urlencode({"head_sha": sha, "event": "push", "branch": "main", "per_page": 10})
        return self._get(f"/repos/{self.repo}/actions/workflows/{self.workflow}/runs?{consulta}")["workflow_runs"]


def decidir(head_main: str, sha: str, execucoes: list[dict[str, Any]]) -> tuple[str, dict[str, Any] | None]:
    """Uma rodada: "superado", "esperar", "verde" ou "vermelho", e a execução do CI olhada."""
    if head_main != sha:
        return "superado", None
    if not execucoes:
        # O CI e este workflow nascem do mesmo push; o CI pode levar alguns
        # segundos para aparecer na API.
        return "esperar", None
    execucao = max(execucoes, key=lambda e: e["id"])
    if execucao.get("status") != "completed":
        return "esperar", execucao
    if execucao.get("conclusion") == "success":
        return "verde", execucao
    return "vermelho", execucao


def esperar(
    api: Any,
    sha: str,
    prazo_s: float,
    intervalo_s: float,
    dormir: Callable[[float], None] = time.sleep,
    relogio: Callable[[], float] = time.monotonic,
    log: Callable[[str], None] = print,
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Repete decidir() até sair de "esperar" ou o prazo acabar ("sem_resposta")."""
    inicio = relogio()
    execucao: dict[str, Any] | None = None
    head: str | None = None
    ultimo_estado = None
    while True:
        try:
            head = api.head_main()
            execucoes = api.execucoes_ci(sha)
        except ErroTransitorio as erro:
            log(f"API do GitHub falhou ({erro}); tento de novo.")
        else:
            decisao, execucao = decidir(head, sha, execucoes)
            if decisao != "esperar":
                return decisao, execucao, head
            estado = (execucao or {}).get("status", "ainda não apareceu")
            if estado != ultimo_estado:
                log(f"CI de {sha[:7]}: {estado}. Esperando.")
                ultimo_estado = estado
        if relogio() - inicio >= prazo_s:
            return "sem_resposta", execucao, head
        dormir(intervalo_s)


def escrever_saida(caminho: str | None, publicar: bool) -> None:
    if not caminho:
        return
    with open(caminho, "a", encoding="utf-8") as saida:
        saida.write(f"publicar={'true' if publicar else 'false'}\n")


def main(env: dict[str, str] | None = None, api: Any = None, **opcoes: Any) -> int:
    env = dict(os.environ) if env is None else env
    sha = env["GITHUB_SHA"]
    prazo_min = int(env.get("PRAZO_MINUTOS", "45"))
    if api is None:
        api = GitHub(env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"], env.get("GITHUB_API_URL", "https://api.github.com"))

    try:
        decisao, execucao, head = esperar(api, sha, prazo_s=prazo_min * 60, intervalo_s=20, **opcoes)
    except urllib.error.HTTPError as erro:
        print(f"::error::GitHub respondeu {erro.code} em {erro.filename}. Confira as permissões do job (actions: read, contents: read).")
        escrever_saida(env.get("GITHUB_OUTPUT"), False)
        return 1

    escrever_saida(env.get("GITHUB_OUTPUT"), decisao == "verde")
    url = (execucao or {}).get("html_url", "")
    if decisao == "verde":
        print(f"CI de {sha[:7]} verde ({url}); publicando na homologação.")
        return 0
    if decisao == "superado":
        print(f"::notice::{sha[:7]} não é mais o HEAD da main ({(head or '')[:7]}); a homologação fica para a execução de {(head or '')[:7]}, que está na fila.")
        return 0
    if decisao == "vermelho":
        print(f"::error::O CI de {sha[:7]} terminou {execucao.get('conclusion')} ({url}); nada sobe. A homologação fica no último commit publicado até o próximo push verde, ou até rodar de novo esta execução depois de o CI ficar verde.")
        return 1
    print(f"::error::O CI de {sha[:7]} não terminou em {prazo_min} min ({url or 'execução não encontrada'}); nada sobe.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
