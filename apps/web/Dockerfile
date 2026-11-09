# The web app: static files served by nginx, which also forwards /api to the API.
# Build from the repository root:  docker build -f apps/web/Dockerfile -t chekmark-web .
# Set API_UPSTREAM to where the API listens, for example api:3000 (compose) or api.railway.internal:3000.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN pnpm --filter web build

# nginx without root, listening on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
ENV API_UPSTREAM=api:3000
# Makes the image fill NGINX_LOCAL_RESOLVERS from /etc/resolv.conf for the template.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
