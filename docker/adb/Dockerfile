# adb in a box. This container is the only thing that talks to your TV.
FROM debian:bookworm-20241111-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip jq \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://dl.google.com/android/repository/platform-tools_r35.0.2-linux.zip -o /tmp/pt.zip \
 && unzip -q /tmp/pt.zip -d /opt \
 && rm /tmp/pt.zip

ENV PATH=$PATH:/opt/platform-tools
