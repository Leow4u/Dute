"""Testes do tools/banco_rh.sh, com um gcloud de mentira no PATH.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

import full_reset_btg

SCRIPT = Path(__file__).resolve().parent / "banco_rh.sh"
RAIZ = SCRIPT.parent.parent

# O gcloud de mentira guarda o banco e as agendas de backup num JSON e anota
# cada chamada, uma por linha, em outro arquivo.
FAKE_GCLOUD = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json, os, re, sys

    estado_path = os.environ["FAKE_GCLOUD_STATE"]
    with open(estado_path, encoding="utf-8") as arquivo:
        estado = json.load(arquivo)
    args = sys.argv[1:]
    with open(os.environ["FAKE_GCLOUD_LOG"], "a", encoding="utf-8") as log:
        log.write(" ".join(args) + "\\n")

    def flag(nome):
        for arg in args:
            if arg.startswith(nome + "="):
                return arg.split("=", 1)[1]
        return None

    def salvar():
        with open(estado_path, "w", encoding="utf-8") as arquivo:
            json.dump(estado, arquivo)

    if estado.get("erro"):
        print("ERROR: (gcloud) " + estado["erro"] + ": negado.", file=sys.stderr)
        sys.exit(1)
    comando = " ".join(arg for arg in args if not arg.startswith("--"))
    banco = estado.get("banco")
    if comando == "firestore databases create" and estado.get("sem_permissao_no_create"):
        print("ERROR: (gcloud.firestore.databases.create) [conta] does not have permission to access projects instance [p] (or it may not exist): The caller does not have permission.", file=sys.stderr)
        sys.exit(1)
    # Com o papel, o create confere o id como o Firestore: de 4 a 63
    # caracteres, minúsculas, números e hífen, começando por letra
    # (24/10/2026, com "rh").
    if comando == "firestore databases create" and not re.fullmatch(r"[a-z][a-z0-9-]{2,61}[a-z0-9]", flag("--database") or ""):
        print("ERROR: (gcloud.firestore.databases.create) INVALID_ARGUMENT: database_id should be 4-63 characters, and valid characters are /[a-z][0-9]-/", file=sys.stderr)
        sys.exit(1)
    if comando == "firestore databases describe":
        if banco is None:
            print("ERROR: (gcloud.firestore.databases.describe) NOT_FOUND: Project or database does not exist.", file=sys.stderr)
            sys.exit(1)
        print("\\t".join([banco["locationId"], banco["type"], banco["deleteProtectionState"], banco["pointInTimeRecoveryEnablement"]]))
    elif comando == "firestore databases create":
        estado["banco"] = {
            "locationId": flag("--location"),
            "type": "FIRESTORE_NATIVE" if flag("--type") == "firestore-native" else "DATASTORE_MODE",
            "deleteProtectionState": "DELETE_PROTECTION_ENABLED" if "--delete-protection" in args else "DELETE_PROTECTION_DISABLED",
            "pointInTimeRecoveryEnablement": "POINT_IN_TIME_RECOVERY_DISABLED",
        }
        salvar()
    elif comando == "firestore databases update":
        if "--delete-protection" in args:
            banco["deleteProtectionState"] = "DELETE_PROTECTION_ENABLED"
        if "--enable-pitr" in args:
            banco["pointInTimeRecoveryEnablement"] = "POINT_IN_TIME_RECOVERY_ENABLED"
        salvar()
    elif comando == "firestore backups schedules list":
        print(json.dumps(estado.get("agendas", [])))
    elif comando == "firestore backups schedules create":
        estado.setdefault("agendas", []).append({"dailyRecurrence": {}, "retention": "1209600s"})
        salvar()
    else:
        print("comando inesperado: " + comando, file=sys.stderr)
        sys.exit(2)
    """
)

COMPLETO = {
    "locationId": "southamerica-east1",
    "type": "FIRESTORE_NATIVE",
    "deleteProtectionState": "DELETE_PROTECTION_ENABLED",
    "pointInTimeRecoveryEnablement": "POINT_IN_TIME_RECOVERY_ENABLED",
}


class BancoRhTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        gcloud = self.dir / "gcloud"
        gcloud.write_text(FAKE_GCLOUD, encoding="utf-8")
        gcloud.chmod(0o755)
        self.estado = self.dir / "estado.json"
        self.log = self.dir / "chamadas.log"

    def rodar(self, projeto: str, estado: dict) -> subprocess.CompletedProcess[str]:
        self.estado.write_text(json.dumps(estado), encoding="utf-8")
        self.log.write_text("", encoding="utf-8")
        env = {
            **os.environ,
            "PATH": f"{self.dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE_GCLOUD_STATE": str(self.estado),
            "FAKE_GCLOUD_LOG": str(self.log),
        }
        return subprocess.run(["bash", str(SCRIPT), projeto], env=env, capture_output=True, text=True, check=False)

    def chamadas(self) -> list[str]:
        return [linha for linha in self.log.read_text(encoding="utf-8").splitlines() if linha]

    def comandos(self) -> list[str]:
        return [" ".join(arg for arg in linha.split() if not arg.startswith("--")) for linha in self.chamadas()]

    def banco(self) -> dict | None:
        return json.loads(self.estado.read_text(encoding="utf-8")).get("banco")

    def test_sem_banco_na_producao_cria_com_protecao_pitr_e_backup(self) -> None:
        resultado = self.rodar("dute-prod", {"banco": None})
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertEqual(
            self.comandos(),
            [
                "firestore databases describe",
                "firestore databases create",
                "firestore databases describe",
                "firestore databases update",
                "firestore backups schedules list",
                "firestore backups schedules create",
                "firestore databases describe",
            ],
        )
        criar = self.chamadas()[1]
        for parte in ("--database=dute-rh", "--location=southamerica-east1", "--type=firestore-native", "--delete-protection", "--project=dute-prod"):
            self.assertIn(parte, criar)
        self.assertIn("--enable-pitr", self.chamadas()[3])
        self.assertIn("--recurrence=daily --retention=14d", self.chamadas()[5])
        self.assertEqual(self.banco(), COMPLETO)
        self.assertIn("OK: o banco dute-rh do dute-prod", resultado.stdout)

    def test_rodar_de_novo_so_confere(self) -> None:
        agendas = [{"dailyRecurrence": {}, "retention": "1209600s"}]
        resultado = self.rodar("dute-prod", {"banco": COMPLETO, "agendas": agendas})
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertEqual(
            self.comandos(),
            ["firestore databases describe", "firestore backups schedules list", "firestore databases describe"],
        )

    def test_homologacao_nao_cria_backup(self) -> None:
        resultado = self.rodar("dute-homolog", {"banco": None})
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertNotIn("backups", " ".join(self.chamadas()))
        self.assertEqual(self.banco(), COMPLETO)

    def test_banco_sem_protecao_ganha_a_protecao(self) -> None:
        resultado = self.rodar("dute-homolog", {"banco": {**COMPLETO, "deleteProtectionState": "DELETE_PROTECTION_DISABLED"}})
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertEqual(self.banco(), COMPLETO)

    def test_sem_o_papel_falha_citando_o_papel_e_nao_cria(self) -> None:
        resultado = self.rodar("dute-homolog", {"banco": None, "erro": "PERMISSION_DENIED"})
        self.assertEqual(resultado.returncode, 1)
        self.assertIn("roles/datastore.owner", resultado.stderr)
        self.assertIn("github-actions-functions@dute-homolog.iam.gserviceaccount.com", resultado.stderr)
        self.assertEqual(self.comandos(), ["firestore databases describe"])

    def test_sem_o_papel_no_create_tambem_cita_o_papel(self) -> None:
        # Em 24/10/2026 o describe achou o banco ausente e o create recusou
        # sem a palavra PERMISSION_DENIED.
        resultado = self.rodar("dute-homolog", {"banco": None, "sem_permissao_no_create": True})
        self.assertEqual(resultado.returncode, 1)
        self.assertIn("does not have permission", resultado.stderr)
        self.assertIn("roles/datastore.owner", resultado.stderr)
        self.assertIsNone(self.banco())

    def test_banco_em_outra_regiao_falha_sem_mexer(self) -> None:
        resultado = self.rodar("dute-prod", {"banco": {**COMPLETO, "locationId": "us-east1", "pointInTimeRecoveryEnablement": "POINT_IN_TIME_RECOVERY_DISABLED"}})
        self.assertEqual(resultado.returncode, 1)
        self.assertIn("us-east1", resultado.stderr)
        self.assertEqual(self.comandos(), ["firestore databases describe"])

    def test_o_banco_e_o_da_codebase_rh_e_o_que_a_zeragem_recusa(self) -> None:
        script = re.search(r"^DATABASE=(\S+)$", SCRIPT.read_text(encoding="utf-8"), re.M)
        codebase = re.search(r'^export const RH_DATABASE = "([^"]+)";$', (RAIZ / "functions/rh/src/domain/banco.ts").read_text(encoding="utf-8"), re.M)
        self.assertIsNotNone(script)
        self.assertIsNotNone(codebase)
        self.assertEqual(script.group(1), codebase.group(1))
        self.assertEqual(full_reset_btg.PROTECTED_DATABASES, (codebase.group(1),))

    def test_projeto_fora_da_lista_falha_sem_chamar_o_gcloud(self) -> None:
        resultado = self.rodar("dute-btg", {"banco": None})
        self.assertEqual(resultado.returncode, 1)
        self.assertIn("só nasce no dute-homolog e no dute-prod", resultado.stderr)
        self.assertEqual(self.chamadas(), [])


if __name__ == "__main__":
    unittest.main()
