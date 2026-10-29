// PM2 process file for the production VM (see DEPLOYMENT.md).
//   pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate
//   pm2 start ecosystem.config.cjs && pm2 save
// Both processes run the built output (apps/api/dist, produced by tsup) and
// read the rest of their config from the repo-root .env. Values set here win
// over .env (dotenv never overrides an existing variable).
module.exports = {
  apps: [
    {
      // HTTP + WebSocket API, and the built apps/web SPA from the same
      // origin (apps/api/src/index.ts serves apps/web/dist in production).
      name: "canvas-api",
      script: "apps/api/dist/index.js",
      cwd: __dirname,
      env: { NODE_ENV: "production", DB_POOL_MAX: "5" },
      max_memory_restart: "700M",
      time: true,
    },
    {
      // BullMQ worker: image/Brain/copywriter/embedding jobs, scheduler
      // ticks, Slack delivery. Smaller DB pool — Supabase free tier caps
      // total connections, and the worker's queries are sequential per job.
      name: "canvas-worker",
      script: "apps/api/dist/worker.js",
      cwd: __dirname,
      env: { NODE_ENV: "production", DB_POOL_MAX: "3" },
      max_memory_restart: "700M",
      time: true,
    },
  ],
};
