# consentgate-mcp — container image for Glama introspection + stdio runtime.
# The server speaks MCP over stdio. tools/list works without CONSENTGATE_API_KEY
# (the key is only needed when a tool is actually invoked), so introspection passes
# with no secrets baked in. Provide CONSENTGATE_API_KEY at run time to call the API.

# ---- build stage: compile TypeScript -> dist/ ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
# --ignore-scripts so the `prepare` (tsc) hook doesn't run before src/ is copied
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

# ---- runtime stage: prod deps + built output only ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
