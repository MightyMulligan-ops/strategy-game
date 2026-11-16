FROM node:24-bookworm
# A real installation at a fixed, world-readable path. Do not use a HOME-scoped
# Corepack cache: the untrusted runtime changes HOME and has no network.
RUN npm install --prefix /opt/sovereign pnpm@12.18.0 --ignore-scripts --no-audit --no-fund \
    && test "$(/opt/sovereign/node_modules/.bin/pnpm --version)" = "12.18.0" \
    && python3 --version && git --version
ENV COREPACK_ENABLE_NETWORK=0
ENV PATH="/opt/sovereign/node_modules/.bin:${PATH}"
WORKDIR /workspace
