# Espelho do Docker Hub mantido pelo Google: o Docker Hub limita pulls anônimos
# por IP e já derrubou o deploy no GitHub Actions com "429 Too Many Requests"
# (09/10/2026). A imagem é a mesma nginx:1.27-alpine oficial.
FROM mirror.gcr.io/library/nginx:1.27-alpine

COPY deploy/cloud-run/nginx.conf /etc/nginx/conf.d/default.conf
COPY artifacts/app/dist/public /usr/share/nginx/html

EXPOSE 8080
