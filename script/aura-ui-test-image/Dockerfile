# Build once locally; configure the resulting immutable image ID in the runner.
# Dependency installation happens only here, never while executing a package.
FROM node:24-bookworm-slim
WORKDIR /opt/aura
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact react@19.2.0 react-dom@19.2.0 jsdom@26.1.0 esbuild@0.25.0
ENV NODE_ENV=test
USER 65534:65534
ENTRYPOINT ["node"]
