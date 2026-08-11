FROM alpine:3.19
RUN apk add --no-cache g++ make

# Pre-compile bits/stdc++.h as a Precompiled Header (PCH) at image build time.
#
# Without this, g++ spawns cc1plus which must parse ~500 individual header files
# every time a user includes <bits/stdc++.h>. That parse alone exceeds the 50 MB
# container limit and the OOM killer terminates cc1plus with:
#   fatal error: Killed signal terminated program cc1plus
#
# With the PCH (.gch file), g++ replaces the entire parse with a single binary
# read. RAM usage during compilation drops by ~80% and compile speed improves
# significantly. g++ detects the .gch automatically — no compile-flag changes needed.
#
# The -std=c++17 and -O2 flags here MUST match the flags used at runtime
# in sandbox.js, otherwise g++ will ignore the PCH and fall back to full parsing.
RUN BITS_HDR=$(find /usr/include -name "stdc++.h" | head -1) && \
    [ -n "$BITS_HDR" ] && \
    g++ -std=c++17 -O2 -x c++-header "$BITS_HDR" -o "${BITS_HDR}.gch" && \
    echo "PCH built at ${BITS_HDR}.gch"

RUN addgroup -S runner && adduser -S runner -G runner
WORKDIR /code
# runner needs write access to /tmp for the compiled binary (/tmp/prog)
USER runner
