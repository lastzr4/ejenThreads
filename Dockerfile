# Playwright's official image ships Node + Chromium + every system library
# headless Chromium needs (fonts, codecs, etc). Nixpacks can't easily supply
# those system deps, so this project builds via Docker on Railway instead.
# Keep this version in sync with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
