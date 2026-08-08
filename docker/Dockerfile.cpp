FROM alpine:3.19
RUN apk add --no-cache g++ make
RUN addgroup -S runner && adduser -S runner -G runner
WORKDIR /code
# runner needs to write /tmp/prog during compilation
USER runner
