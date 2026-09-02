FROM nginx:1.27-alpine

COPY deploy/cloud-run/nginx.conf /etc/nginx/conf.d/default.conf
COPY artifacts/btg-inventory/dist/public /usr/share/nginx/html

EXPOSE 8080
