# Local setup (Windows)

This guide gets Canvas running on a Windows PC from scratch. You don't need Docker. Locally, the app uses:

- **Supabase**: a free hosted Postgres database (project `canvas-dev`).
- **Cloudflare R2**: free hosted file storage (bucket `canvas-dev`).
- **Redis**: a small queue server, running inside WSL (Linux on Windows).

It takes about 30–45 minutes the first time. Do the steps in order.

---

## 1. Install the basic tools

1. **Git**: download from <https://git-scm.com/download/win> and install with the default options.
2. **Node.js 22 or newer**: download the LTS installer from <https://nodejs.org> and install it.
3. **pnpm**: open **PowerShell** (Start menu → type "PowerShell") and run:

   ```powershell
   npm install -g pnpm@11
   pnpm -v
   ```

   The second command should print a version number starting with `11`.

> **Tip:** don't put the project inside a OneDrive folder (for example `Desktop` or `Documents` when OneDrive backup is on). OneDrive sync has corrupted `node_modules` here before. A plain folder like `C:\dev\canvas-app` is safest.

## 2. Install WSL and Redis

Redis is the queue the background worker uses (image generation, reminders, and so on).

1. Open **PowerShell as Administrator** (right-click PowerShell → "Run as administrator") and run:

   ```powershell
   wsl --install
   ```

2. **Restart the computer** when it asks.
3. After the restart, an **Ubuntu** window opens by itself. If it doesn't, find "Ubuntu" in the Start menu. Pick a username and password when asked. This is a separate Linux login, and you'll need the password for `sudo`.
4. In the Ubuntu window, install and start Redis:

   ```bash
   sudo apt update
   sudo apt install -y redis-server
   sudo service redis-server start
   redis-cli ping
   ```

   The last command should print `PONG`.

5. **Every time you restart Windows**, Redis has to be started again. Open the Ubuntu window and run:

   ```bash
   sudo service redis-server start
   ```

   (Optional: to start it automatically, run `sudo systemctl enable redis-server` once. This only works if systemd is enabled, which it is by default on recent WSL versions.)

Windows reaches Redis inside WSL at `127.0.0.1:6379`, so no extra network setup is needed.

## 3. Create the Supabase database (`canvas-dev`)

1. Go to <https://supabase.com> and sign up (GitHub login is easiest).
2. Click **New project**:
   - **Name:** `canvas-dev`
   - **Database password:** click "Generate a password", then **copy it somewhere safe**. You'll need it in step 6.
   - **Region:** pick the one closest to you (for Kosovo: _Central EU (Frankfurt)_).
   - **Plan:** Free.
3. Wait a minute or two while the project is created.
4. Click **Connect** in the top bar, then choose **Session pooler**. Copy the connection string. It looks like:

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

   - Make sure it's the **Session pooler** with port **5432**. The _Transaction pooler_ (port 6543) does **not** work with this app.
   - Replace `[YOUR-PASSWORD]` with the password from step 2, without the brackets.

You don't need to enable anything else. The app's migrations turn on the `vector` extension themselves.

> Free Supabase projects **pause after 7 days without use**. If the app suddenly can't reach the database, open the Supabase dashboard and click **Restore project**.

## 4. Create the Cloudflare R2 bucket (`canvas-dev`)

1. Go to <https://dash.cloudflare.com> and sign up.
2. In the left menu, open **R2 Object Storage**. Cloudflare asks you to add a payment method to enable R2. The free tier (10 GB) is not charged, but a card has to be on file.
3. Click **Create bucket**, name it `canvas-dev`, and leave the location on _Automatic_. Click **Create bucket**.
4. **Allow uploads from the app (CORS).** Open the bucket → **Settings** → **CORS Policy** → **Add CORS policy**, paste this, and save:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5183"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

5. **Create an access key.** Go back to the **R2 Object Storage** overview → **Manage API tokens** (or "API" → "Manage API tokens") → **Create API token**:
   - **Permissions:** _Object Read & Write_
   - **Specify bucket(s):** only `canvas-dev`
   - Click **Create API Token**.
   - Copy the **Access Key ID** and **Secret Access Key** now. The secret is shown only once.
6. **Find the endpoint.** The same page, or the R2 overview under "Account Details", shows an **S3 API** URL like `https://1234567890abcdef.r2.cloudflarestorage.com`. Copy it **without** any bucket name at the end.

## 5. Get the code and install packages

In **PowerShell**:

```powershell
cd C:\dev                      # or wherever you keep projects
git clone <repo-url> canvas-app
cd canvas-app
pnpm install
```

## 6. Fill in `.env`

```powershell
copy .env.example .env
notepad .env
```

Fill in these lines. The comments in the file say where each value comes from.

| Variable                                    | Value                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                              | The Supabase Session pooler string from step 3, with your password in it |
| `REDIS_URL`                                 | `redis://127.0.0.1:6379` (already filled in)                             |
| `S3_ENDPOINT`                               | The R2 S3 API URL from step 4.6                                          |
| `S3_REGION`                                 | `auto` (already filled in)                                               |
| `S3_BUCKET`                                 | `canvas-dev`                                                             |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | The R2 token keys from step 4.5                                          |
| `S3_FORCE_PATH_STYLE`                       | `false` (already filled in)                                              |
| `WEB_URL`                                   | `http://localhost:5183` (already filled in)                              |

Everything else can stay empty. AI features fall back to built-in mocks without API keys.

## 7. Create the database tables

```powershell
pnpm db:migrate
```

It should end with `migrations applied successfully!`.

## 8. Run the app

Make sure Redis is running (step 2.5), then:

```powershell
pnpm dev
```

This starts the API, the background worker and the web app together. Open <http://localhost:5183>, click **Sign up**, and create your first account and workspace.

Stop everything with `Ctrl + C`.

## 9. Running the tests (optional)

```powershell
pnpm check     # typecheck + lint + formatting
pnpm test      # unit tests
pnpm --filter @canvas/e2e exec playwright install chromium   # once
pnpm test:e2e  # browser tests — stop `pnpm dev` first
```

The browser tests create lots of throwaway users and workspaces in your `canvas-dev` database. That's fine, because it's your own dev database, but never point them at production.

## Troubleshooting

| Symptom                                            | Fix                                                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:6379`                      | Redis isn't running. Open Ubuntu and run `sudo service redis-server start`.                                                                   |
| Database connection times out                      | The Supabase project is paused. Restore it in the dashboard. Also check that the string uses port **5432** (Session pooler).                  |
| `password authentication failed`                   | The password in `DATABASE_URL` is wrong, or still contains the `[ ]` brackets. You can reset it under Supabase → Project Settings → Database. |
| File uploads fail in the browser with a CORS error | The R2 CORS policy (step 4.4) is missing, or `AllowedOrigins` doesn't exactly match `WEB_URL`.                                                |
| API log: `bucket "canvas-dev" isn't reachable`     | Wrong `S3_ENDPOINT`/keys, the bucket doesn't exist yet, or the token isn't scoped to this bucket.                                             |
| `pnpm install` fails or packages go missing        | The project is inside a OneDrive folder. Move it out (see step 1) and run `pnpm install` again.                                               |
