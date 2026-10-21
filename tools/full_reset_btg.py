"""Zeragem total do Firestore de produção para um novo go-live.

Apaga todas as coleções de dados — catálogo, estoque, fluxos físicos,
solicitações, pedidos, faturamento, eventos, Agent Dute, documentos,
contadores e controles — preservando só o acesso (usuários, convites, contas
de cliente e configuração do sistema) e, por padrão, a estrutura (clientes,
endereços, lista de preços e configuração de cobrança; ver --include-setup).

As coleções são descobertas no banco (listCollectionIds), não numa lista
fixa: a zeragem de julho (reset_btg_inventory.py) deixou request_counters e
ops_aggregates para trás justamente por depender de uma lista escrita antes
dessas coleções existirem.

A zeragem é do WMS e nunca apaga dado do Comercial: as coleções dele ficam
sempre, inclusive com --include-setup, e em `events` ficam os eventos com
source "functions_comercial". Se a zeragem fosse apagar `customers` e algum
cadastro tem o campo `stage` (do Comercial), ela para antes de alterar
qualquer coisa.

Sem --apply, só audita e exibe o plano. Com --apply, exige a frase de
confirmação e um export gerenciado do Firestore (--export-to gs://...), que é
o backup restaurável (gcloud firestore import). O roteiro completo, com o que
fazer antes e depois, está em docs/novo-go-live-zeragem-total.md.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from reset_btg_inventory import (
    BACKUP_DIR,
    GCLOUD,
    access_token,
    batch_write,
    create_backup,
    decode_document,
    document_name,
    fetch_snapshot,
    firestore_value,
    guarded_upsert,
    inventory_control,
    request_json,
    utc_now,
)


PROJECT_ID = "dute-btg"
DATABASE = "(default)"
CUSTOMER_CODE = "BTG Pactual"

# Sem estas coleções ninguém entra no sistema: o login é fechado por convite e
# o papel de cada pessoa vem de `users`; `customer_accounts` liga usuário a
# cliente e `system_settings` guarda a configuração do painel. Nunca apagadas.
ACCESS_COLLECTIONS = ("users", "invites", "customer_accounts", "system_settings")
# Estrutura, não histórico: clientes (com o perfil de operação publicado para o
# portal e os módulos contratados em client_access), endereços do armazém,
# lista de preços e configuração de cobrança. Só são apagadas com
# --include-setup.
SETUP_COLLECTIONS = (
    "customers",
    "client_profiles",
    "client_access",
    "locations",
    "warehouse_positions",
    "billing_price_list",
    "billing_config",
)
# Comercial (docs/plataforma/fase-6-comercial.md): cadastro comercial,
# contratos, catálogo e tabelas, demandas, orçamentos, autorizações, medições,
# contador e recibos. Não é dado do WMS: nunca apagadas, nem com
# --include-setup. As subcoleções (contracts/*/aditivos, quotes/*/revisoes)
# ficam com o pai: o script só lê documentos das coleções raiz e recusa apagar
# qualquer caminho dentro destas.
COMERCIAL_COLLECTIONS = (
    "customer_locations",
    "customer_contacts",
    "contracts",
    "lpu_items",
    "price_tables",
    "demands",
    "quotes",
    "client_authorizations",
    "medicoes",
    "demand_counters",
    "comercial_operations",
)
# Os eventos do Comercial moram em `events`, junto dos do WMS: a zeragem apaga
# só os outros.
COMERCIAL_EVENT_SOURCE = "functions_comercial"
# O Comercial marca em `customers` o campo `stage` (prospect ou cliente).
CUSTOMERS_COLLECTION = "customers"
STAGE_FIELD = "stage"
CONTROL_COLLECTION = "system_controls"
CONTROL_DOC = "inventory"
EVENTS_COLLECTION = "events"
RUNNING_STATUS = "full_reset_running"
COMPLETED_STATUS = "full_reset_completed"
RESET_REASON = "Zeragem total para novo go-live"
BACKUP_FORMAT = "firestore-rest-full-reset-backup-v1"
NOT_COVERED = (
    "Firebase Authentication (contas de login): preservado",
    "Cloud Storage dute-btg.firebasestorage.app (fotos, anexos, documentos): "
    "limpeza manual, ver docs/novo-go-live-zeragem-total.md",
    "Subcoleções: só os documentos das coleções raiz são lidos e apagados",
)


def confirmation_phrase(project_id: str, database: str) -> str:
    return f"APAGAR TUDO {project_id}/{database}"


def preserved_collections(
    *,
    include_setup: bool,
    keep: Iterable[str] = (),
) -> set[str]:
    preserved = set(ACCESS_COLLECTIONS) | set(COMERCIAL_COLLECTIONS)
    if not include_setup:
        preserved.update(SETUP_COLLECTIONS)
    preserved.update(name.strip() for name in keep if name.strip())
    return preserved


def split_collections(
    existing: Iterable[str],
    preserved: set[str],
) -> tuple[list[str], list[str]]:
    """Separa o que existe no banco entre apagar e preservar."""
    names = sorted(set(existing))
    to_delete = [name for name in names if name not in preserved]
    kept = [name for name in names if name in preserved]
    return to_delete, kept


def list_root_collections(
    *,
    project_id: str,
    database: str,
    token: str,
) -> list[str]:
    url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}/"
        f"databases/{database}/documents:listCollectionIds"
    )
    ids: list[str] = []
    page_token: str | None = None
    while True:
        payload: dict[str, Any] = {"pageSize": 300}
        if page_token:
            payload["pageToken"] = page_token
        result = request_json(
            url,
            token=token,
            project_id=project_id,
            method="POST",
            payload=payload,
        )
        ids.extend(str(name) for name in result.get("collectionIds", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            return sorted(set(ids))


def control_document_name(project_id: str, database: str) -> str:
    return document_name(
        CONTROL_COLLECTION,
        CONTROL_DOC,
        project_id=project_id,
        database=database,
    )


def document_path(name: str) -> str:
    """Caminho a partir da raiz do banco: `contracts/ct1/aditivos/ad1`."""
    return name.split("/documents/", 1)[-1]


def comercial_path(name: str) -> bool:
    """Documento dentro de uma coleção do Comercial, em qualquer nível."""
    return document_path(name).split("/", 1)[0] in COMERCIAL_COLLECTIONS


def comercial_event(collection: str, document: dict[str, Any]) -> bool:
    """Evento gravado pelas Functions do Comercial: fica na zeragem."""
    if collection != EVENTS_COLLECTION:
        return False
    source = document.get("fields", {}).get("source")
    return isinstance(source, dict) and source.get("stringValue") == COMERCIAL_EVENT_SOURCE


def has_stage(document: dict[str, Any]) -> bool:
    return STAGE_FIELD in document.get("fields", {})


def customers_blocking(
    snapshot: dict[str, list[dict[str, Any]]],
    to_delete: list[str],
) -> list[str]:
    """Cadastros com `stage` que a zeragem apagaria (só com --include-setup)."""
    if CUSTOMERS_COLLECTION not in to_delete:
        return []
    return sorted(
        str(document.get("name", "")).rsplit("/", 1)[-1]
        for document in snapshot.get(CUSTOMERS_COLLECTION, [])
        if has_stage(document)
    )


def stage_message(customer_ids: list[str]) -> str:
    return (
        "A zeragem apagaria customers, e estes cadastros têm o campo stage, "
        f"que é do Comercial: {', '.join(customer_ids)}. Sem o cadastro, "
        "contratos, demandas e orçamentos ficam sem cliente. Rode sem "
        "--include-setup, que preserva a estrutura, ou mantenha o cliente "
        "inteiro com --keep customers --keep client_profiles --keep client_access."
    )


def removable(collection: str, document: dict[str, Any], *, control_name: str) -> bool:
    """O que sai da coleção: tudo, menos o controle (é reescrito) e os eventos
    do Comercial."""
    name = str(document.get("name", ""))
    return bool(name) and name != control_name and not comercial_event(collection, document)


def delete_writes(
    snapshot: dict[str, list[dict[str, Any]]],
    collections: Iterable[str],
    *,
    control_name: str,
) -> list[dict[str, Any]]:
    """Deletes sem precondição: tudo vai embora, e a verificação final confere.

    O controle de estoque (`system_controls/inventory`) não entra: ele fica
    congelado durante a zeragem e é reescrito no fim com o estado de go-live.
    Os eventos do Comercial também não. O cadastro de cliente só sai se não
    mudou desde a leitura: um que tenha ganhado `stage` no meio fica.
    """
    writes: list[dict[str, Any]] = []
    for collection in collections:
        for document in snapshot.get(collection, []):
            if not removable(collection, document, control_name=control_name):
                continue
            name = str(document["name"])
            if comercial_path(name):
                raise RuntimeError(
                    "A zeragem não apaga dado do Comercial: " + document_path(name)
                )
            if collection == CUSTOMERS_COLLECTION and has_stage(document):
                raise RuntimeError(
                    "A zeragem não apaga cadastro com stage: " + document_path(name)
                )
            write: dict[str, Any] = {"delete": name}
            if collection == CUSTOMERS_COLLECTION and document.get("updateTime"):
                write["currentDocument"] = {"updateTime": document["updateTime"]}
            writes.append(write)
    return writes


def deletable_counts(
    snapshot: dict[str, list[dict[str, Any]]],
    collections: Iterable[str],
    *,
    control_name: str,
) -> dict[str, int]:
    """Quantos documentos saem de cada coleção; o controle não conta (é
    reescrito) e os eventos do Comercial ficam."""
    return {
        collection: sum(
            1
            for document in snapshot.get(collection, [])
            if removable(collection, document, control_name=control_name)
        )
        for collection in collections
    }


def comercial_event_count(snapshot: dict[str, list[dict[str, Any]]]) -> int:
    return sum(
        1
        for document in snapshot.get(EVENTS_COLLECTION, [])
        if comercial_event(EVENTS_COLLECTION, document)
    )


def leftover_counts(
    snapshot: dict[str, list[dict[str, Any]]],
    collections: Iterable[str],
    *,
    control_name: str,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for collection in collections:
        remaining = [
            document
            for document in snapshot.get(collection, [])
            if removable(collection, document, control_name=control_name)
        ]
        if remaining:
            counts[collection] = len(remaining)
    return counts


def replace_write(
    collection: str,
    document_id: str,
    data: dict[str, Any],
    current: dict[str, Any] | None,
    *,
    project_id: str,
    database: str,
) -> dict[str, Any]:
    """Substitui o documento inteiro (sem updateMask): campos velhos somem."""
    write: dict[str, Any] = {
        "update": {
            "name": document_name(
                collection,
                document_id,
                project_id=project_id,
                database=database,
            ),
            "fields": {
                key: firestore_value(value)
                for key, value in data.items()
            },
        }
    }
    if current and current.get("updateTime"):
        write["currentDocument"] = {"updateTime": current["updateTime"]}
    elif current:
        write["currentDocument"] = {"exists": True}
    else:
        write["currentDocument"] = {"exists": False}
    return write


def restore_control_write(
    before: dict[str, Any] | None,
    current: dict[str, Any] | None,
    *,
    project_id: str,
    database: str,
) -> dict[str, Any]:
    """Devolve o controle ao estado anterior ao congelamento (ou o remove)."""
    if before:
        write: dict[str, Any] = {
            "update": {
                "name": before["name"],
                "fields": before.get("fields", {}),
            }
        }
        if current and current.get("updateTime"):
            write["currentDocument"] = {"updateTime": current["updateTime"]}
        else:
            write["currentDocument"] = {"exists": True}
        return write
    return {"delete": control_document_name(project_id, database)}


def restore_control(
    before: dict[str, Any] | None,
    *,
    project_id: str,
    database: str,
    token: str,
) -> None:
    """Desfaz o congelamento da zeragem, relendo o controle atual."""
    controls_now = fetch_snapshot(
        (CONTROL_COLLECTION,),
        project_id=project_id,
        database=database,
        token=token,
    )
    batch_write(
        [
            restore_control_write(
                before,
                inventory_control(controls_now),
                project_id=project_id,
                database=database,
            )
        ],
        project_id=project_id,
        database=database,
        token=token,
    )


def export_destination(export_to: str, reset_id: str) -> str:
    base = export_to.strip().rstrip("/")
    if not base.startswith("gs://") or len(base) <= len("gs://"):
        raise ValueError("--export-to precisa ser um caminho gs://bucket[/prefixo].")
    return f"{base}/{reset_id}"


def run_managed_export(
    destination: str,
    *,
    project_id: str,
    database: str,
    gcloud: str | None = GCLOUD,
) -> str:
    """Export gerenciado do Firestore (síncrono). Falha = exceção, nada apagado."""
    if not gcloud:
        raise RuntimeError("Google Cloud CLI não encontrado para o export gerenciado.")
    output = subprocess.check_output(
        [
            gcloud,
            "firestore",
            "export",
            destination,
            "--project",
            project_id,
            "--database",
            database,
            "--format",
            "json",
        ],
        text=True,
    )
    try:
        operation = json.loads(output or "{}")
    except json.JSONDecodeError:
        operation = {}
    metadata = operation.get("metadata", {}) if isinstance(operation, dict) else {}
    if not isinstance(metadata, dict):
        metadata = {}
    return str(metadata.get("outputUriPrefix") or destination)


def build_plan(
    *,
    mode: str,
    project_id: str,
    database: str,
    snapshot: dict[str, list[dict[str, Any]]],
    to_delete: list[str],
    kept: list[str],
    include_setup: bool,
    keep: list[str],
    control: dict[str, Any],
    control_name: str,
) -> dict[str, Any]:
    delete_counts = deletable_counts(snapshot, to_delete, control_name=control_name)
    return {
        "mode": mode,
        "project_id": project_id,
        "database": database,
        "confirmation": confirmation_phrase(project_id, database),
        "documents_to_delete": sum(delete_counts.values()),
        "delete": delete_counts,
        "preserve": {name: len(snapshot.get(name, [])) for name in kept},
        "preserve_events": {
            "source": COMERCIAL_EVENT_SOURCE,
            "documents": comercial_event_count(snapshot),
        },
        "include_setup": include_setup,
        "keep": keep,
        "inventory_control": control,
        "after": {
            f"{CONTROL_COLLECTION}/{CONTROL_DOC}": (
                "reescrito: estoque não inicializado, inventário de abertura "
                "obrigatório, movimentações liberadas"
            ),
            EVENTS_COLLECTION: "1 evento system.full_reset_completed",
        },
        "not_covered": list(NOT_COVERED),
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=(
            "Apaga todas as coleções de dados do Firestore para um novo go-live, "
            "preservando acesso, o Comercial e (por padrão) estrutura. Sem "
            "--apply, apenas audita e exibe o plano."
        )
    )
    result.add_argument("--project-id", default=PROJECT_ID)
    result.add_argument("--database", default=DATABASE)
    result.add_argument("--customer-code", default=CUSTOMER_CODE)
    result.add_argument("--backup-path", type=Path)
    result.add_argument(
        "--export-to",
        help=(
            "gs://bucket[/prefixo] do export gerenciado do Firestore; "
            "obrigatório com --apply"
        ),
    )
    result.add_argument(
        "--include-setup",
        action="store_true",
        help=(
            "apaga também a estrutura: "
            + ", ".join(SETUP_COLLECTIONS)
            + ". O Comercial nunca é apagado; cadastro com stage em customers "
            "para a zeragem"
        ),
    )
    result.add_argument(
        "--keep",
        action="append",
        default=[],
        metavar="COLECAO",
        help="coleção extra a preservar (repetível)",
    )
    result.add_argument("--apply", action="store_true")
    result.add_argument("--confirm")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    keep = [name.strip() for name in args.keep if name.strip()]
    if CONTROL_COLLECTION in keep:
        raise SystemExit(
            f"--keep {CONTROL_COLLECTION} não é permitido: o controle de estoque "
            "é reescrito pela zeragem."
        )
    preserved = preserved_collections(include_setup=args.include_setup, keep=keep)
    control_name = control_document_name(args.project_id, args.database)

    token = access_token()
    existing = list_root_collections(
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    to_delete, kept = split_collections(existing, preserved)
    snapshot = fetch_snapshot(
        existing,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    control_raw = inventory_control(snapshot)
    control = decode_document(control_raw)
    plan = build_plan(
        mode="apply" if args.apply else "dry-run",
        project_id=args.project_id,
        database=args.database,
        snapshot=snapshot,
        to_delete=to_delete,
        kept=kept,
        include_setup=args.include_setup,
        keep=keep,
        control=control,
        control_name=control_name,
    )
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    # Prospect e cliente do Comercial moram em customers: com --include-setup a
    # zeragem os apagaria e deixaria contratos, demandas e orçamentos sem
    # cliente. Para aqui, no dry-run e no apply, antes de qualquer escrita.
    blocking = customers_blocking(snapshot, to_delete)
    if blocking:
        raise SystemExit(stage_message(blocking) + " Nada foi alterado.")
    expected_confirmation = confirmation_phrase(args.project_id, args.database)
    if not args.apply:
        print(
            "\nDry-run concluído. Nenhum dado foi alterado. Para aplicar, use "
            "--apply --export-to gs://bucket/prefixo "
            f"--confirm {expected_confirmation!r}."
        )
        return 0

    if args.confirm != expected_confirmation:
        raise SystemExit(
            f"Confirmação obrigatória: --confirm {expected_confirmation!r}"
        )
    if not args.export_to:
        raise SystemExit(
            "--apply exige --export-to gs://bucket[/prefixo]: o export gerenciado "
            "do Firestore é o backup restaurável da zeragem."
        )
    if (
        control.get("movements_frozen") is True
        and control.get("reconciliation_status") != RUNNING_STATUS
    ):
        raise SystemExit(
            "O estoque está congelado por outra operação. Resolva o controle "
            f"{CONTROL_COLLECTION}/{CONTROL_DOC} antes de continuar."
        )

    reset_id = "full-reset-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = export_destination(args.export_to, reset_id)

    frozen_at = utc_now()
    batch_write(
        [
            guarded_upsert(
                CONTROL_COLLECTION,
                CONTROL_DOC,
                {
                    "movements_frozen": True,
                    "imports_frozen": True,
                    "reconciliation_status": RUNNING_STATUS,
                    "reconciliation_id": reset_id,
                    "reason": RESET_REASON,
                    "frozen_at": frozen_at,
                    "updated_at_iso": frozen_at,
                },
                control_raw,
                project_id=args.project_id,
                database=args.database,
            )
        ],
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    print("Movimentações congeladas durante a zeragem.")

    # O backup local é tirado depois do congelamento, para refletir exatamente
    # o que será apagado; o export gerenciado é a cópia restaurável.
    frozen_snapshot = fetch_snapshot(
        to_delete,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    # O Comercial não para durante a zeragem: um prospect pode ter nascido
    # depois do plano. O que sai é este snapshot, então a conferência é nele.
    blocking = customers_blocking(frozen_snapshot, to_delete)
    if blocking:
        reason = stage_message(blocking) + " O cadastro apareceu depois do plano."
        try:
            restore_control(
                control_raw,
                project_id=args.project_id,
                database=args.database,
                token=token,
            )
        except Exception as restore_error:  # noqa: BLE001
            raise SystemExit(
                f"{reason} Nada foi apagado, mas o controle de estoque não pôde "
                "ser restaurado e as movimentações seguem congeladas. "
                f"Restauração: {restore_error}"
            ) from restore_error
        raise SystemExit(
            f"{reason} Nada foi apagado e o controle de estoque voltou ao estado "
            "anterior."
        )
    backup_path, backup_hash = create_backup(
        args.backup_path or BACKUP_DIR / f"{reset_id}.json",
        frozen_snapshot,
        project_id=args.project_id,
        database=args.database,
        backup_format=BACKUP_FORMAT,
    )
    print(f"Backup local criado: {backup_path}")
    print(f"SHA-256: {backup_hash}")

    try:
        export_uri = run_managed_export(
            destination,
            project_id=args.project_id,
            database=args.database,
        )
    except Exception as error:  # noqa: BLE001 - qualquer falha: desfaz o congelamento
        try:
            restore_control(
                control_raw,
                project_id=args.project_id,
                database=args.database,
                token=token,
            )
        except Exception as restore_error:  # noqa: BLE001
            raise SystemExit(
                "O export gerenciado falhou e o controle de estoque não pôde ser "
                "restaurado: nada foi apagado, mas as movimentações seguem "
                f"congeladas. Export: {error}. Restauração: {restore_error}"
            ) from error
        raise SystemExit(
            "O export gerenciado falhou; nada foi apagado e o controle de estoque "
            f"voltou ao estado anterior. Detalhe: {error}"
        ) from error
    print(f"Export gerenciado concluído: {export_uri}")
    # O export é a etapa longa; o token do gcloud vale uma hora.
    token = access_token()

    writes = delete_writes(frozen_snapshot, to_delete, control_name=control_name)
    batch_write(
        writes,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )

    # Verificação com leituras fortes: nada fora do preservado pode sobrar, nem
    # coleção que tenha surgido durante a zeragem.
    suspects = [
        name
        for name in list_root_collections(
            project_id=args.project_id,
            database=args.database,
            token=token,
        )
        if name not in preserved
    ]
    remaining = fetch_snapshot(
        suspects,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    leftovers = leftover_counts(remaining, suspects, control_name=control_name)
    if leftovers:
        raise RuntimeError(
            "A verificação encontrou registros remanescentes. O estoque permanece "
            "congelado; rode de novo para concluir. Contagens: "
            + json.dumps(leftovers, ensure_ascii=False)
        )

    controls_now = fetch_snapshot(
        (CONTROL_COLLECTION,),
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    completed_at = utc_now()
    event_id = "evt_" + reset_id
    delete_counts = deletable_counts(frozen_snapshot, to_delete, control_name=control_name)
    comercial_events = comercial_event_count(frozen_snapshot)
    batch_write(
        [
            replace_write(
                CONTROL_COLLECTION,
                CONTROL_DOC,
                {
                    "movements_frozen": False,
                    "imports_frozen": True,
                    "reconciliation_status": COMPLETED_STATUS,
                    "reconciliation_id": reset_id,
                    "last_reconciliation_id": reset_id,
                    "last_reconciled_at": completed_at,
                    "stock_initialized": False,
                    "opening_inventory_required": True,
                    "reason": RESET_REASON,
                    "full_reset_at": completed_at,
                    "full_reset_backup": str(backup_path),
                    "full_reset_backup_sha256": backup_hash,
                    "full_reset_export": export_uri,
                    "full_reset_deleted_documents": len(writes),
                    "full_reset_preserved_collections": kept,
                    "updated_at_iso": completed_at,
                },
                inventory_control(controls_now),
                project_id=args.project_id,
                database=args.database,
            ),
            guarded_upsert(
                EVENTS_COLLECTION,
                event_id,
                {
                    "id": event_id,
                    "type": "system.full_reset_completed",
                    "title": "Sistema zerado para novo go-live",
                    "description": (
                        "Todas as coleções de dados foram removidas após export "
                        "gerenciado e backup verificado. Preservados: "
                        + (", ".join(kept) or "nenhuma coleção")
                        + f". Eventos do Comercial preservados: {comercial_events}."
                    ),
                    "severity": "attention",
                    "entity_type": "full_reset",
                    "entity_id": reset_id,
                    "customer_code": args.customer_code,
                    "source": "tools/full_reset_btg.py",
                    "payload": {
                        "deleted_collections": delete_counts,
                        "preserved_collections": kept,
                        "preserved_comercial_events": comercial_events,
                        "include_setup": args.include_setup,
                        "backup_sha256": backup_hash,
                        "export": export_uri,
                    },
                    "occurred_at": completed_at,
                },
                None,
                project_id=args.project_id,
                database=args.database,
            ),
        ],
        project_id=args.project_id,
        database=args.database,
        token=token,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "reset_id": reset_id,
                "deleted_documents": len(writes),
                "deleted_collections": delete_counts,
                "preserved_collections": kept,
                "preserved_comercial_events": comercial_events,
                "backup": str(backup_path),
                "backup_sha256": backup_hash,
                "export": export_uri,
                "movements_frozen": False,
                "opening_inventory_required": True,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
