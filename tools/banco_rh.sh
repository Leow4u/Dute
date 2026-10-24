#!/usr/bin/env bash
# Cria ou confere o banco Firestore do RH, `dute-rh`, de um projeto (Fase 8,
# docs/plataforma/fase-8-rh.md). Roda pelo workflow .github/workflows/banco-rh.yml,
# com a conta github-actions-functions@<projeto>:
#
#   bash tools/banco_rh.sh <dute-homolog|dute-prod>
#
# - Os dois projetos: o banco em southamerica-east1, nativo, com proteção
#   contra exclusão e PITR desde a criação.
# - dute-prod: também o backup diário de 14 dias, como o banco padrão
#   (docs/plataforma/backup-e-recuperacao.md).
#
# Pode rodar de novo: o que já existe só é conferido. Nunca apaga nem desliga
# nada. Banco em outra região ou de outro tipo falha, porque não dá para mudar.
set -euo pipefail

PROJECT_ID="${1:?Uso: bash tools/banco_rh.sh <dute-homolog|dute-prod>}"
DATABASE=dute-rh
LOCATION=southamerica-east1
CONTA="github-actions-functions@${PROJECT_ID}.iam.gserviceaccount.com"
# Segundos da primeira espera quando o Firestore aborta uma mudança; os testes
# usam 0.
ESPERA="${BANCO_RH_ESPERA:-5}"

case "${PROJECT_ID}" in
  dute-homolog|dute-prod) ;;
  *)
    echo "::error::O banco ${DATABASE} só nasce no dute-homolog e no dute-prod, não no ${PROJECT_ID}." >&2
    exit 1
    ;;
esac

ERRO="$(mktemp)"
trap 'rm -f "${ERRO}"' EXIT

falhou() {
  cat "${ERRO}" >&2
  # O describe diz PERMISSION_DENIED; o create, em 24/10/2026, disse só "does
  # not have permission to access projects instance".
  if grep -qiE "PERMISSION_DENIED|does not have permission" "${ERRO}"; then
    echo "::error::A conta ${CONTA} não tem roles/datastore.owner no ${PROJECT_ID}. O comando que concede está em docs/plataforma/fase-8-rh.md." >&2
  fi
  exit 1
}

# Logo depois de criar o banco, o Firestore recusa mudá-lo por alguns segundos
# ("ABORTED: There are concurrent database changes", 24/10/2026, na
# homologação). A mudança abortada se repete até 5 vezes, esperando cada vez
# mais (5, 10, 15 e 20 segundos); qualquer outro erro falha na hora.
mudar() {
  local tentativa
  for tentativa in 1 2 3 4 5; do
    if "$@" 2>"${ERRO}"; then
      return 0
    fi
    if [ "${tentativa}" -eq 5 ] || ! grep -q ABORTED "${ERRO}"; then
      return 1
    fi
    echo "O Firestore ainda está mudando o banco; nova tentativa em $((tentativa * ESPERA))s."
    sleep "$((tentativa * ESPERA))"
  done
}

descrever() {
  gcloud firestore databases describe --database="${DATABASE}" --project="${PROJECT_ID}" \
    --format="value(locationId,type,deleteProtectionState,pointInTimeRecoveryEnablement)" 2>"${ERRO}"
}

if ESTADO="$(descrever)"; then
  echo "O banco ${DATABASE} já existe no ${PROJECT_ID}."
elif grep -q NOT_FOUND "${ERRO}"; then
  echo "Criando o banco ${DATABASE} no ${PROJECT_ID} (${LOCATION})."
  gcloud firestore databases create --database="${DATABASE}" --location="${LOCATION}" \
    --type=firestore-native --delete-protection --enable-pitr --project="${PROJECT_ID}" 2>"${ERRO}" || falhou
  ESTADO="$(descrever)" || falhou
else
  falhou
fi

read -r LOCAL TIPO PROTECAO PITR <<<"${ESTADO}"
if [ "${LOCAL}" != "${LOCATION}" ] || [ "${TIPO}" != "FIRESTORE_NATIVE" ]; then
  echo "::error::O banco ${DATABASE} do ${PROJECT_ID} está em ${LOCAL} (${TIPO}); o RH precisa de ${LOCATION} (FIRESTORE_NATIVE)." >&2
  exit 1
fi

if [ "${PROTECAO}" != "DELETE_PROTECTION_ENABLED" ]; then
  echo "Ligando a proteção contra exclusão."
  mudar gcloud firestore databases update --database="${DATABASE}" --delete-protection --project="${PROJECT_ID}" || falhou
fi

if [ "${PITR}" != "POINT_IN_TIME_RECOVERY_ENABLED" ]; then
  echo "Ligando o PITR (7 dias)."
  mudar gcloud firestore databases update --database="${DATABASE}" --enable-pitr --project="${PROJECT_ID}" || falhou
fi

if [ "${PROJECT_ID}" = "dute-prod" ]; then
  AGENDAS="$(gcloud firestore backups schedules list --database="${DATABASE}" --project="${PROJECT_ID}" --format=json 2>"${ERRO}")" || falhou
  if python3 -c '
import json, sys
agendas = json.loads(sys.stdin.read() or "[]")
sys.exit(0 if any("dailyRecurrence" in a and a.get("retention") == "1209600s" for a in agendas) else 1)
' <<<"${AGENDAS}"; then
    echo "O backup diário de 14 dias já existe."
  else
    echo "Criando o backup diário de 14 dias."
    mudar gcloud firestore backups schedules create --database="${DATABASE}" --recurrence=daily --retention=14d \
      --project="${PROJECT_ID}" || falhou
  fi
fi

ESTADO="$(descrever)" || falhou
read -r LOCAL TIPO PROTECAO PITR <<<"${ESTADO}"
if [ "${PROTECAO}" != "DELETE_PROTECTION_ENABLED" ] || [ "${PITR}" != "POINT_IN_TIME_RECOVERY_ENABLED" ]; then
  echo "::error::O banco ${DATABASE} do ${PROJECT_ID} ficou com ${PROTECAO} e ${PITR}." >&2
  exit 1
fi
echo "OK: o banco ${DATABASE} do ${PROJECT_ID} está em ${LOCAL}, com proteção contra exclusão e PITR."
