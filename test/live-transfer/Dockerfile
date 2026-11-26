FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libx11-xcb1 \
    libatk-bridge2.0-0 libdrm2 libxkbcommon0 libsecret-1-0 ca-certificates fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/haia-runtime --no-audit --no-fund \
    electron@45.4.1 @wppconnect/wa-js@4.8.2 tar@7.5.23
RUN node /opt/haia-runtime/node_modules/electron/install.js
ARG TEST_UID=501
ARG TEST_GID=20
RUN getent group "$TEST_GID" >/dev/null || groupadd --gid "$TEST_GID" haia
RUN useradd --uid "$TEST_UID" --gid "$TEST_GID" --home-dir /tmp/haia-home --no-create-home haia
ENV NODE_PATH=/opt/haia-runtime/node_modules HOME=/tmp/haia-home HAIA_LIVE_NO_SANDBOX=1
WORKDIR /work
COPY linux-entry.sh /usr/local/bin/haia-live-entry
ENTRYPOINT ["/bin/sh","/usr/local/bin/haia-live-entry"]
