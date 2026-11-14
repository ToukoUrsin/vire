# Vire: the Bun server and the built web app in one small container (the same pair that runs behind /vire on the dev box).
FROM oven/bun:1.4 AS web
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/bun.lock ./web/
RUN cd web && bun install --frozen-lockfile
COPY web ./web
RUN cd web && bun run build

FROM oven/bun:1.4-slim
# ffmpeg checks and levels the day's generated laugh and question
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/bun.lock ./server/
RUN cd server && bun install --frozen-lockfile --production
COPY server ./server
COPY --from=web /app/web/dist ./web/dist
# the phone app, already built (mobile/dist is committed); served at /app/
COPY mobile/dist ./mobile/dist
ENV PORT=8080 HOST=0.0.0.0 VIRE_DB=/data/vire.sqlite VIRE_DAILY_DIR=/data/daily VIRE_HALL_LOG=/data/hall.jsonl VIRE_ELEVEN_LOG=/data/elevenlabs.jsonl VIRE_EAR_DIR=/data/ear/ VIRE_SOUND_DIR=/data/sound/
EXPOSE 8080
WORKDIR /app/server
CMD ["bun", "index.ts"]
