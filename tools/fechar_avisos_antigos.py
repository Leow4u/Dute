"""Fecha os avisos antigos do Agent Dute que ficaram abertos.

O painel antigo do Agent Dute listava a caixa `ai_agent_inbox`, com
"Resolver" em cada aviso. Onde o agente do núcleo roda (o dute-homolog e o
dute-prod), o painel novo (aprovado pelo Leonardo em 04/11/2026,
docs/plataforma/fase-5-memoria.md) não lê mais essa caixa, e o evento de
rotina deixou de abrir aviso nela (functions/wms/src/domain/caixa-do-agente.ts).
Os avisos que já estavam abertos ficariam assim para sempre: este script os
marca como resolvidos, como o "Resolver" do painel antigo fazia (`status`
"resolved", `resolved_by` e `resolved_at`), com o script e a conta do gcloud
como quem resolveu.

Nada se apaga: o aviso fica no banco, resolvido, e o evento de origem
continua em `events`.

Sem --apply, só lista o que fecharia. Com --apply, grava em lotes, cada aviso
com a precondição da versão lida: o aviso que mudou depois da leitura para o
lote, e rodar de novo fecha o que faltou (só os abertos são lidos).

Rodar da máquina do responsável, com o gcloud logado na conta da Dutelog:

    cd C:\\DEV\\Dute
    python tools\\fechar_avisos_antigos.py --project-id dute-homolog
    python tools\\fechar_avisos_antigos.py --project-id dute-homolog --apply
    python tools\\fechar_avisos_antigos.py --project-id dute-prod
    python tools\\fechar_avisos_antigos.py --project-id dute-prod --apply
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from typing import Any

from reset_btg_inventory import (
    GCLOUD,
    access_token,
    batch_write,
    decode_document,
    fetch_collection_raw,
    firestore_value,
)


COLLECTION = "ai_agent_inbox"
DATABASE = "(default)"
# Onde o agente do núcleo roda: CORE_AGENT_PROJECTS de
# functions/wms/src/domain/agent-routines.ts. No dute-btg o painel antigo
# ainda lê a caixa, e o script não roda lá.
PROJECTS = ("dute-homolog", "dute-prod")
SCRIPT = "tools/fechar_avisos_antigos.py"
RESOLUTION = "painel antigo do Agent Dute retirado em 04/11/2026"


def conta_do_gcloud() -> str | None:
    """A conta logada no gcloud, para o aviso dizer quem rodou o script."""
    if not GCLOUD:
        return None
    try:
        conta = subprocess.check_output(
            [GCLOUD, "config", "get-value", "account"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return conta or None


def avisos_abertos(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Os avisos que o painel antigo mostraria: todo o que não está resolvido."""
    return [
        document
        for document in documents
        if decode_document(document).get("status", "open") != "resolved"
    ]


def escrita_de_fechamento(document: dict[str, Any], *, ator: dict[str, Any]) -> dict[str, Any]:
    """O mesmo que o "Resolver" do painel antigo, com a precondição da versão lida."""
    fields = {
        "status": "resolved",
        "resolved_by": ator,
        "resolution": RESOLUTION,
    }
    return {
        "update": {
            "name": document["name"],
            "fields": {key: firestore_value(value) for key, value in fields.items()},
        },
        "updateMask": {"fieldPaths": sorted(fields)},
        "updateTransforms": [
            {"fieldPath": "resolved_at", "setToServerValue": "REQUEST_TIME"},
            {"fieldPath": "updated_at", "setToServerValue": "REQUEST_TIME"},
        ],
        "currentDocument": {"updateTime": document["updateTime"]},
    }


def descrever(document: dict[str, Any]) -> str:
    dados = decode_document(document)
    aviso_id = document["name"].rsplit("/", 1)[-1]
    partes = [
        aviso_id,
        str(dados.get("created_at") or "sem data"),
        str(dados.get("customer_code") or "sem cliente"),
        str(dados.get("title") or "sem título"),
    ]
    return " · ".join(partes)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Fecha os avisos antigos do Agent Dute (ai_agent_inbox) que ficaram abertos.",
    )
    result.add_argument("--project-id", required=True, choices=PROJECTS)
    result.add_argument("--database", default=DATABASE)
    result.add_argument("--apply", action="store_true", help="grava; sem ele, só lista")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    token = access_token()
    documents = fetch_collection_raw(
        COLLECTION,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    abertos = sorted(
        avisos_abertos(documents),
        key=lambda document: str(decode_document(document).get("created_at") or ""),
    )
    print(f"{len(abertos)} aviso(s) aberto(s) em {COLLECTION} de {args.project_id}/{args.database}.")
    for document in abertos:
        print(f"- {descrever(document)}")
    if not abertos:
        return 0
    if not args.apply:
        print("Nada foi gravado. Para fechar, rode de novo com --apply.")
        return 0
    ator = {
        "uid": SCRIPT,
        "email": conta_do_gcloud(),
        "name": "Fechamento dos avisos antigos",
        "role": "script",
    }
    batch_write(
        [escrita_de_fechamento(document, ator=ator) for document in abertos],
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    print(f"{len(abertos)} aviso(s) fechado(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
