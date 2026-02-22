# Stage 1: Install all dependencies
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build client (Vite) + server (esbuild)
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# Stage 3: Production image
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY data/ai-analyzed ./data/ai-analyzed

EXPOSE 5000
CMD ["node", "--max-old-space-size=768", "dist/index.cjs"]
