FROM golang:1.22-alpine
RUN addgroup -S runner && adduser -S runner -G runner
USER runner
WORKDIR /code
