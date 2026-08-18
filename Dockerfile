FROM node:22-bookworm-slim

ENV NODE_ENV=production
# Hostless exposes the web process on port 8000 by default.
ENV PORT=8000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
# Install a pinned pnpm directly; this avoids Corepack signature drift in slim images.
RUN npm install --global pnpm@11.19.0 && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 8000
CMD ["node", "dist/src/index.js"]
