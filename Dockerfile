FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace config first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.jsons for all workspace packages the server needs
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/engine/ packages/engine/
COPY server/ server/

# Railway sets PORT env var automatically
ENV NODE_ENV=production

EXPOSE 3001

# Use tsx to run TypeScript directly — avoids complex multi-package build
CMD ["pnpm", "--filter", "@lorcana-sim/server", "exec", "tsx", "src/index.ts"]
