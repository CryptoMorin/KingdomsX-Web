FROM node:22-alpine AS build
WORKDIR /app
ARG PUBLIC_SITE_URL=https://kingdomsx.com
ARG PUBLIC_ASSETS_BASE=https://assets.kingdomsx.com
ARG PUBLIC_GIT_COMMIT_SHA
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
ENV PUBLIC_ASSETS_BASE=${PUBLIC_ASSETS_BASE}
ENV PUBLIC_GIT_COMMIT_SHA=${PUBLIC_GIT_COMMIT_SHA}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/conf.d/ /etc/nginx/conf.d/
COPY --from=build /app/dist/ /srv/kingdomsx/home/
COPY --from=build /app/public/assets/ /srv/kingdomsx/assets/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q --header="Host: kingdomsx.com" -O- http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
