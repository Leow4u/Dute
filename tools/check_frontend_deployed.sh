#!/usr/bin/env bash
# Confere se cada URL está servindo o build de frontend informado.
#
# Uso: tools/check_frontend_deployed.sh <dist/public/index.html> <url> [<url>...]
#
# Compara os assets referenciados pelo index.html do build com os do index.html
# servido em cada URL. Os nomes de arquivo do Vite são hash de conteúdo, então
# só batem quando o código servido é o mesmo que foi montado. Tenta por até
# CHECK_ATTEMPTS vezes (padrão 12) com CHECK_PAUSE_SECONDS entre elas (padrão
# 10), para dar tempo de o tráfego migrar. Sai com 1 se alguma URL não estiver
# servindo o build, com 2 se os argumentos ou o build estiverem errados.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "uso: $0 <index.html do build> <url> [<url>...]"
  exit 2
fi

built="$1"
shift
attempts="${CHECK_ATTEMPTS:-12}"
pause="${CHECK_PAUSE_SECONDS:-10}"

assets_of() {
  grep -o '/assets/[^"]*' | sort -u
}

if [ ! -f "${built}" ]; then
  echo "::error::${built} não existe; gere o build antes."
  exit 2
fi

expected="$(assets_of < "${built}" || true)"
if [ -z "${expected}" ]; then
  echo "::error::${built} não referencia nenhum asset; o build está quebrado?"
  exit 2
fi

status=0
for base in "$@"; do
  served=""
  for attempt in $(seq 1 "${attempts}"); do
    served="$(curl -sS --max-time 20 -H 'Cache-Control: no-cache' "${base%/}/index.html?check=${attempt}" | assets_of || true)"
    if [ "${served}" = "${expected}" ]; then
      echo "OK: ${base} está servindo o build (tentativa ${attempt})."
      continue 2
    fi
    if [ "${attempt}" -lt "${attempts}" ]; then
      sleep "${pause}"
    fi
  done
  echo "::error::${base} não está servindo o build esperado."
  echo "  esperado:"
  printf '    %s\n' ${expected}
  echo "  servido:"
  printf '    %s\n' ${served:-"(nada)"}
  status=1
done

exit "${status}"
