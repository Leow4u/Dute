"""Decide o que a homologação publica depois que o CI termina.

A espera ativa (um runner parado até o CI acabar) saiu. O homologacao.yml
dispara com workflow_run quando o CI completa. Este módulo ainda sabe duas
coisas:

- `esperar` / `main`: o laço antigo, coberto por teste. O workflow não chama
  mais. Ficou porque o incidente de 22/10/2026 está descrito aqui.
- `sha_para_homologacao` / `main --sha`: o que o workflow chama. O CI que
  disparou publica o próprio commit se ele ainda é o HEAD. Se a main andou e
  o CI de push mais novo do HEAD já está verde, publica o HEAD — o
  workflow_run desse commit pode ter sido tirado da fila por este, que chegou
  depois (o GitHub só guarda um pendente no grupo). Se o CI do HEAD ainda
  corre ou falhou, não publica: o workflow_run dele publica, ou nada sobe.

Até 22/10/2026 a fila era do job de publicação do ci.yml, que só entrava nela
quando os testes do commit acabavam. Os testes de pushes seguidos terminam fora
de ordem, e o GitHub mantém só o último a chegar na espera.

`main` (sem argumento) grava publicar=true|false em $GITHUB_OUTPUT.
`main --sha` grava sha=<commit>|sha= e exige CI_SHA, GITHUB_REPOSITORY e
GITHUB_TOKEN (actions: read e contents: read).
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


def sha_para_homologacao(head: str, ci_sha: str, execucoes_do_head: list[dict[str, Any]]) -> str | None:
    """Commit a publicar, ou None.

    ci_sha é o commit do CI que disparou o workflow_run (já verde). execucoes_do_head
    são as execuções de push do CI do HEAD, ignoradas quando os dois SHAs coincidem.
    """
    if head == ci_sha:
        return ci_sha
    if not execucoes_do_head:
        return None
    execucao = max(execucoes_do_head, key=lambda item: item["id"])
    if execucao.get("status") == "completed" and execucao.get("conclusion") == "success":
        return head
    return None


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


def main_sha(env: dict[str, str] | None = None, api: Any = None) -> int:
    env = dict(os.environ) if env is None else env
    ci_sha = env["CI_SHA"]
    if api is None:
        api = GitHub(env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"], env.get("GITHUB_API_URL", "https://api.github.com"))
    try:
        head = api.head_main()
        execucoes = [] if head == ci_sha else api.execucoes_ci(head)
    except ErroTransitorio as erro:
        print(f"::error::API do GitHub falhou ({erro}); nada sobe. Rode de novo a Homologação quando a API responder.")
        _gravar_sha(env.get("GITHUB_OUTPUT"), None)
        return 1
    except urllib.error.HTTPError as erro:
        print(f"::error::GitHub respondeu {erro.code} em {erro.filename}. Confira as permissões do job (actions: read, contents: read).")
        _gravar_sha(env.get("GITHUB_OUTPUT"), None)
        return 1
    sha = sha_para_homologacao(head, ci_sha, execucoes)
    _gravar_sha(env.get("GITHUB_OUTPUT"), sha)
    if sha == ci_sha:
        print(f"CI de {sha[:7]} verde e ainda é o HEAD; publicando.")
    elif sha:
        print(f"::notice::{ci_sha[:7]} não é mais o HEAD; o CI de {sha[:7]} está verde, publicando esse.")
    else:
        print(f"::notice::{ci_sha[:7]} não é o HEAD ({head[:7]}) e o CI desse HEAD ainda não está verde; a publicação fica para o workflow_run dele.")
    return 0


def _gravar_sha(caminho: str | None, sha: str | None) -> None:
    if not caminho:
        return
    with open(caminho, "a", encoding="utf-8") as saida:
        saida.write(f"sha={sha or ''}\n")


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
    sys.exit(main_sha() if "--sha" in sys.argv[1:] else main())
