FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/corsd ./cmd/corsd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget
COPY --from=build /out/corsd /usr/local/bin/corsd
RUN adduser -D -H -u 65532 app
USER 65532:65532
EXPOSE 7080
ENTRYPOINT ["/usr/local/bin/corsd"]
