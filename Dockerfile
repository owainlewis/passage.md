FROM node:22-bookworm AS web

WORKDIR /src

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web apps/web
RUN npm run build:web

FROM golang:1.26-bookworm AS server

WORKDIR /src

COPY go.work go.work
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download

COPY server server
COPY --from=web /src/apps/web/out/ server/internal/web/dist/
RUN cd server && CGO_ENABLED=0 GOOS=linux go build -o /out/passage ./cmd/passage

FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=server /out/passage /app/passage

EXPOSE 8080
USER nonroot:nonroot

ENTRYPOINT ["/app/passage"]
CMD ["serve"]
