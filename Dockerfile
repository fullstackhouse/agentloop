FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

ENTRYPOINT ["node", "dist/cli.js", "serve"]
