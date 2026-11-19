# Espelho do Docker Hub mantido pelo Google, o mesmo da imagem do app.
# O contexto de build leva só esta imagem, o nginx e o dist do painel.
FROM mirror.gcr.io/library/nginx:1.27-alpine

COPY deploy/cloud-run/nginx.conf /etc/nginx/conf.d/default.conf
COPY artifacts/dute-zap/dist/public /usr/share/nginx/html

EXPOSE 8080
