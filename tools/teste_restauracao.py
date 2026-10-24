"""Teste de restauração do backup diário do Firestore da produção.

Restaura o backup READY mais novo de um banco do dute-prod, o `(default)` ou
o `dute-rh`, num banco novo de teste, confere se os documentos do banco de
origem no minuto do backup voltaram e apaga o banco de teste. Roteiro e
registro: docs/plataforma/backup-e-recuperacao.md, "Teste de restauração".

    python tools/teste_restauracao.py --banco "(default)"              # só mostra o plano
    python tools/teste_restauracao.py --banco "(default)" --executar   # restaura, confere e apaga

- Lê só os caminhos dos documentos (consulta só de chaves), nunca os campos,
  e o log mostra só contagens por coleção.
- O banco de origem só é lido, no minuto do backup e no seguinte, pelo PITR.
- O banco de teste tem nome reservado (teste-restauracao-<banco>-<instante>)
  e é o único que a ferramenta apaga, inclusive o que sobrou de um teste
  anterior.

Roda pelo workflow .github/workflows/teste-restauracao.yml, com a conta
github-actions-functions@dute-prod (roles/datastore.owner).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import migracao_firestore as m
from reset_btg_inventory import GCLOUD


PROJETO = "dute-prod"
BANCOS = ("(default)", "dute-rh")
NOME_DO_TESTE = re.compile(r"^teste-restauracao-(default|dute-rh)-\d{8}t\d{6}$")
# O PITR guarda 7 dias; a margem cobre o tempo da restauração antes da leitura.
PITR = timedelta(days=7)
MARGEM_DO_PITR = timedelta(hours=1)
# A agenda faz um backup por dia: mais velho que isso, ela parou.
BACKUP_ATRASADO = timedelta(hours=48)
PRAZO_DA_RESTAURACAO = timedelta(minutes=45)
INTERVALO_EM_SEGUNDOS = 15.0
INSTANTE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$")

# argumentos do gcloud -> a saída em JSON (None quando vazia). Nos testes, um gcloud falso.
Gcloud = Callable[[list[str]], Any]
Relogio = Callable[[], datetime]
Espera = Callable[[float], None]


class Falha(Exception):
    """Um passo do teste não deu certo; a mensagem diz qual e o que fazer."""


def gcloud_real(argumentos: list[str]) -> Any:
    if not GCLOUD:
        raise Falha("Google Cloud CLI não encontrado.")
    resultado = subprocess.run([GCLOUD, *argumentos, "--format=json"], capture_output=True, text=True)
    if resultado.returncode != 0:
        raise erro_do_gcloud(argumentos, resultado.stderr)
    saida = resultado.stdout.strip()
    return json.loads(saida) if saida else None


def erro_do_gcloud(argumentos: list[str], stderr: str) -> Falha:
    comando = " ".join(argumentos[:3])
    mensagem = f"gcloud {comando}: {stderr.strip()}"
    if "PERMISSION_DENIED" in stderr or "does not have permission" in stderr:
        mensagem += (
            f"\nA conta github-actions-functions@{PROJETO} precisa de roles/datastore.owner no {PROJETO};"
            " o comando que concede está em docs/plataforma/fase-8-rh.md."
        )
    return Falha(mensagem)


def instante(texto: str) -> datetime:
    """2026-10-25T04:12:37.123456789Z -> datetime em UTC (o Firestore manda até nanossegundos)."""
    achado = INSTANTE.match(texto or "")
    if not achado:
        raise Falha(f"Instante fora do formato do Firestore: {texto!r}")
    base = datetime.strptime(achado.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    fracao = (achado.group(2) or "")[:6].ljust(6, "0")
    return base.replace(microsecond=int(fracao))


def rfc3339(momento: datetime) -> str:
    return momento.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def nome_do_teste(banco: str, agora: datetime) -> str:
    sufixo = "default" if banco == "(default)" else banco
    nome = f"teste-restauracao-{sufixo}-{agora.astimezone(timezone.utc):%Y%m%dt%H%M%S}"
    exigir_banco_de_teste(nome)
    return nome


def exigir_banco_de_teste(nome: str) -> None:
    """A trava de tudo o que apaga ou restaura: só o banco de teste, nunca outro."""
    if nome in BANCOS or not NOME_DO_TESTE.match(nome):
        raise Falha(f"Recusado: {nome!r} não é um banco de teste (teste-restauracao-<banco>-<instante>).")


def bancos_do_projeto(gcloud: Gcloud, projeto: str) -> list[str]:
    lista = gcloud(["firestore", "databases", "list", f"--project={projeto}"]) or []
    return sorted(str(banco.get("name", "")).rsplit("/", 1)[-1] for banco in lista)


def backup_mais_novo(gcloud: Gcloud, projeto: str, banco: str) -> dict[str, Any]:
    backups = gcloud(["firestore", "backups", "list", f"--project={projeto}"]) or []
    do_banco = [
        backup
        for backup in backups
        if backup.get("state") == "READY" and str(backup.get("database", "")).endswith(f"/databases/{banco}")
    ]
    if not do_banco:
        raise Falha(
            f"Nenhum backup READY do {banco} no {projeto}. Confira a agenda:"
            f" gcloud firestore backups schedules list --database={banco} --project {projeto}"
        )
    return max(do_banco, key=lambda backup: instante(backup["snapshotTime"]))


def restaurar(gcloud: Gcloud, projeto: str, backup: str, teste: str) -> str:
    """Pede a restauração e devolve a operação: o gcloud não espera ela terminar."""
    exigir_banco_de_teste(teste)
    operacao = gcloud(
        [
            "firestore",
            "databases",
            "restore",
            f"--source-backup={backup}",
            f"--destination-database={teste}",
            f"--project={projeto}",
        ]
    ) or {}
    nome = str(operacao.get("name", ""))
    if "/operations/" not in nome:
        raise Falha(f"A restauração não devolveu a operação: {json.dumps(operacao)[:300]}")
    return nome


def esperar_restauracao(
    gcloud: Gcloud,
    projeto: str,
    teste: str,
    operacao: str,
    *,
    agora: Relogio,
    esperar: Espera,
    prazo: timedelta = PRAZO_DA_RESTAURACAO,
) -> timedelta:
    inicio = agora()
    while True:
        estado = gcloud(["firestore", "operations", "describe", operacao, f"--database={teste}", f"--project={projeto}"]) or {}
        if estado.get("done"):
            erro = estado.get("error")
            if erro:
                raise Falha(f"A restauração falhou: {erro.get('message', erro) if isinstance(erro, dict) else erro}")
            return agora() - inicio
        if agora() - inicio >= prazo:
            raise Falha(
                f"A restauração não terminou em {int(prazo.total_seconds() // 60)} minutos"
                f" (gcloud firestore operations describe {operacao} --database={teste} --project {projeto})."
            )
        esperar(INTERVALO_EM_SEGUNDOS)


def caminhos(fetch: m.Fetch, projeto: str, banco: str, read_time: str | None = None) -> set[str]:
    return {
        m.relative_path(documento["name"])
        for documento, _ in m.scan_documents(fetch, projeto, database=banco, read_time=read_time, keys_only=True)
    }


@dataclass
class Comparacao:
    """O banco restaurado contra o de origem no minuto cheio do backup e no seguinte.

    O backup é um retrato num instante dentro do minuto, e o PITR só lê a
    origem em minutos cheios. Por isso, o documento criado ou apagado dentro
    do minuto do backup explica a diferença, e o resto não.
    """

    contagens: list[tuple[str, int, int]]
    restaurados: int
    explicados: int
    faltando: Counter[str]
    sobrando: Counter[str]

    @property
    def ok(self) -> bool:
        return not self.faltando and not self.sobrando


def comparar(no_minuto: set[str], no_minuto_seguinte: set[str], restaurado: set[str]) -> Comparacao:
    a_mais = restaurado - no_minuto
    a_menos = no_minuto - restaurado
    # Sobrando: o que o restaurado tem e a origem não tinha no minuto; só se
    # explica se a origem o criou dentro do minuto (está no minuto seguinte).
    sobrando = {caminho for caminho in a_mais if caminho not in no_minuto_seguinte}
    # Faltando: o que a origem tinha no minuto e o restaurado não; só se
    # explica se a origem o apagou dentro do minuto (sumiu no minuto seguinte).
    faltando = {caminho for caminho in a_menos if caminho in no_minuto_seguinte}
    origem = Counter(m.collection_pattern(caminho) for caminho in no_minuto)
    restaurados = Counter(m.collection_pattern(caminho) for caminho in restaurado)
    return Comparacao(
        contagens=[(padrao, origem[padrao], restaurados[padrao]) for padrao in sorted(set(origem) | set(restaurados))],
        restaurados=len(restaurado),
        explicados=len(a_mais) + len(a_menos) - len(sobrando) - len(faltando),
        faltando=Counter(m.collection_pattern(caminho) for caminho in faltando),
        sobrando=Counter(m.collection_pattern(caminho) for caminho in sobrando),
    )


def apagar(gcloud: Gcloud, projeto: str, teste: str) -> None:
    exigir_banco_de_teste(teste)
    gcloud(["firestore", "databases", "delete", f"--database={teste}", f"--project={projeto}", "--quiet"])


def esperar_sumir(gcloud: Gcloud, projeto: str, teste: str, *, esperar: Espera, vezes: int = 8) -> bool:
    """A exclusão é uma operação: o banco pode continuar na lista por alguns segundos."""
    for vez in range(vezes):
        if teste not in bancos_do_projeto(gcloud, projeto):
            return True
        if vez < vezes - 1:
            esperar(INTERVALO_EM_SEGUNDOS)
    return False


def tabela(comparacao: Comparacao, minuto: datetime) -> list[str]:
    cabecalho = ("coleção", f"origem {minuto:%H:%M}", "restaurado")
    largura = max([len(cabecalho[0]), *(len(linha[0]) for linha in comparacao.contagens)])
    linhas = [f"{cabecalho[0]:<{largura}}  {cabecalho[1]:>12}  {cabecalho[2]:>10}"]
    linhas += [f"{padrao:<{largura}}  {origem:>12}  {restaurado:>10}" for padrao, origem, restaurado in comparacao.contagens]
    return linhas


def veredito(comparacao: Comparacao, banco: str, minuto: datetime) -> str:
    if comparacao.ok:
        texto = f"OK: o backup restaurou os {comparacao.restaurados} documentos do {banco}"
        if comparacao.explicados:
            seguinte = minuto + timedelta(minutes=1)
            texto += (
                f"; {comparacao.explicados} diferença(s) explicada(s) por gravações entre"
                f" {minuto:%H:%M} e {seguinte:%H:%M} UTC"
            )
        return texto + "."
    return (
        f"FALHA: {sum(comparacao.faltando.values())} documento(s) faltando e"
        f" {sum(comparacao.sobrando.values())} sobrando no banco restaurado, fora do minuto do backup."
    )


def escrever_resumo(resumo: Path | None, linhas: list[str]) -> None:
    if resumo is None:
        return
    with resumo.open("a", encoding="utf-8") as arquivo:
        arquivo.write("\n".join(linhas) + "\n")


def testar(
    projeto: str,
    banco: str,
    *,
    executar: bool,
    gcloud: Gcloud,
    abrir_fetch: Callable[[], m.Fetch],
    agora: Relogio,
    esperar: Espera,
    resumo: Path | None = None,
) -> int:
    if projeto != PROJETO:
        raise Falha(f"O teste é da produção ({PROJETO}): a homologação não tem backup.")
    if banco not in BANCOS:
        raise Falha(f"Banco {banco!r} fora da lista: {', '.join(BANCOS)}.")

    backup = backup_mais_novo(gcloud, projeto, banco)
    snapshot = instante(backup["snapshotTime"])
    minuto = snapshot.replace(second=0, microsecond=0)
    inicio = agora()
    print(f"Backup {backup['name'].rsplit('/', 1)[-1]} do {banco}, de {backup['snapshotTime']}.")
    if inicio - snapshot > BACKUP_ATRASADO:
        print(f"::warning::O backup mais novo do {banco} tem mais de 48 horas: confira a agenda do backup.")
    if inicio - minuto > PITR - MARGEM_DO_PITR:
        raise Falha(
            f"O backup mais novo do {banco} é de {backup['snapshotTime']}, perto do fim dos 7 dias do PITR:"
            " a origem não pode mais ser lida naquele minuto. Confira a agenda do backup."
        )
    teste = nome_do_teste(banco, inicio)
    print(f"Banco de teste: {teste}.")
    if not executar:
        print("Nada foi restaurado. Com --executar, o teste restaura, confere e apaga o banco de teste.")
        return 0

    for sobra in [nome for nome in bancos_do_projeto(gcloud, projeto) if NOME_DO_TESTE.match(nome)]:
        print(f"Apagando {sobra}, que sobrou de um teste anterior.")
        try:
            apagar(gcloud, projeto, sobra)
        except Falha as erro:
            # Não atrapalha o teste de agora, que usa outro nome.
            print(f"::warning::{erro}")

    ok = False
    try:
        operacao = restaurar(gcloud, projeto, backup["name"], teste)
        print(f"Restaurando ({operacao.rsplit('/', 1)[-1]}).")
        duracao = esperar_restauracao(gcloud, projeto, teste, operacao, agora=agora, esperar=esperar)
        print(f"Restaurado em {int(duracao.total_seconds() // 60)} min {int(duracao.total_seconds() % 60)} s.")
        seguinte = minuto + timedelta(minutes=1)
        while agora() <= seguinte:
            esperar(INTERVALO_EM_SEGUNDOS)
        # O token do gcloud vale uma hora: pedido depois da espera.
        fetch = abrir_fetch()
        comparacao = comparar(
            caminhos(fetch, projeto, banco, rfc3339(minuto)),
            caminhos(fetch, projeto, banco, rfc3339(seguinte)),
            caminhos(fetch, projeto, teste),
        )
        linhas = tabela(comparacao, minuto)
        print("\n".join(linhas))
        for rotulo, contagem in (("faltando", comparacao.faltando), ("sobrando", comparacao.sobrando)):
            for padrao, quantos in sorted(contagem.items()):
                print(f"  {rotulo} em {padrao}: {quantos}")
        texto = veredito(comparacao, banco, minuto)
        print(texto if comparacao.ok else f"::error::{texto}")
        registro = f"| {inicio:%d/%m/%Y} | `{banco}` | {backup['snapshotTime']} | {texto} |"
        print(f"Linha para o registro (backup-e-recuperacao.md): {registro}")
        escrever_resumo(
            resumo,
            [f"### Teste de restauração do `{banco}`", "", "```", *linhas, "```", "", texto, "", registro],
        )
        ok = comparacao.ok
    except (Falha, RuntimeError) as erro:
        # RuntimeError: o Firestore recusou a leitura (request_json).
        print(f"::error::{erro}")
        escrever_resumo(resumo, [f"### Teste de restauração do `{banco}`", "", f"Falhou: {erro}"])
    finally:
        try:
            if teste in bancos_do_projeto(gcloud, projeto):
                apagar(gcloud, projeto, teste)
                if esperar_sumir(gcloud, projeto, teste, esperar=esperar):
                    print(f"Banco de teste {teste} apagado.")
                else:
                    print(f"::warning::O {teste} ainda está saindo da lista; se sobrar, o próximo teste o apaga.")
            print(f"Bancos do {projeto}: {', '.join(bancos_do_projeto(gcloud, projeto))}.")
        except Falha as erro:
            print(f"::error::O banco de teste {teste} pode ter ficado no projeto (o próximo teste o apaga): {erro}")
            ok = False
    return 0 if ok else 1


def parser() -> argparse.ArgumentParser:
    raiz = argparse.ArgumentParser(description="Teste de restauração do backup do Firestore da produção.")
    raiz.add_argument("--projeto", default=PROJETO)
    raiz.add_argument("--banco", required=True, choices=BANCOS)
    raiz.add_argument("--executar", action="store_true", help="restaura, confere e apaga o banco de teste")
    raiz.add_argument("--resumo", type=Path, help="arquivo Markdown que recebe o resultado (o GITHUB_STEP_SUMMARY)")
    return raiz


def main(argv: list[str] | None = None) -> int:
    # O console do Windows nem sempre está em UTF-8; sem isso os acentos saem trocados.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parser().parse_args(argv)
    try:
        return testar(
            args.projeto,
            args.banco,
            executar=args.executar,
            gcloud=gcloud_real,
            abrir_fetch=lambda: m.gcloud_fetch(args.projeto),
            agora=lambda: datetime.now(timezone.utc),
            esperar=time.sleep,
            resumo=args.resumo,
        )
    except (Falha, RuntimeError) as erro:
        print(f"::error::{erro}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
