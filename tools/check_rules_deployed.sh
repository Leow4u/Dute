#!/usr/bin/env bash
# Confere se as regras publicadas no projeto são as deste checkout.
#
# Uso: tools/check_rules_deployed.sh <projeto>
#
# Lê pela API do Firebase Rules a release do Firestore (cloud.firestore) e a do
# bucket padrão do Storage (firebase.storage/<projeto>.firebasestorage.app) e
# compara o conteúdo publicado com o firestore.rules e o storage.rules da raiz do
# repositório. O token vem de ACCESS_TOKEN (no CI, o do google-github-actions/auth)
# ou, sem ele, do gcloud. Precisa de curl e node. Sai com 1 se alguma release
# servir outro conteúdo, com 2 se os argumentos estiverem errados; se a API
# recusar a leitura, sai com o código do curl.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "uso: $0 <projeto>"
  exit 2
fi

project="$1"
token="${ACCESS_TOKEN:-$(gcloud auth print-access-token)}"
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

get() {
  curl -fsS --max-time 20 \
    -H "Authorization: Bearer ${token}" \
    -H "x-goog-user-project: ${project}" \
    "https://firebaserules.googleapis.com/v1/$1"
}

status=0
check() {
  local release="$1" file="$2" ruleset
  ruleset="$(get "projects/${project}/releases/${release}" \
    | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).rulesetName || "")')"
  get "${ruleset}" \
    | node -e '
        const files = JSON.parse(require("fs").readFileSync(0, "utf8")).source.files;
        const file = files.find((f) => f.name === process.argv[1]);
        process.stdout.write(file ? file.content : "");
      ' "${file}" > "${tmp}/publicado"
  if diff "${tmp}/publicado" "${root}/${file}" > "${tmp}/diff"; then
    echo "OK: ${release} serve o ${file} deste checkout (ruleset ${ruleset##*/})."
  else
    echo "::error::${release} não serve o ${file} deste checkout (ruleset ${ruleset##*/})."
    head -n 40 "${tmp}/diff"
    status=1
  fi
}

check cloud.firestore firestore.rules
check "firebase.storage/${project}.firebasestorage.app" storage.rules

exit "${status}"
