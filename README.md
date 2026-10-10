# Kokoro 心

One app for your **Map** (boundary circle), **People** (traits, actions with five levels, reflections) and **Becoming** (thought library and stress-test sessions). It works offline on your phone and syncs through your own Cloudflare site.

| Piece | Name |
|---|---|
| GitHub repository | `brain-rewire` (private) |
| Worker = address | `brain-rewire` → `https://brain-rewire.emile-cao.workers.dev` |
| D1 database | `brain-rewire-db` (ID already in `wrangler.jsonc`) |
| PIN | Runtime secret `PIN` on the Worker, 4–8 digits |
| App file | `public/kokoro.html` (the site opens it) |
| Storage on the phone | `kkr.v1` (data), `kkr.dev` (theme, Lite mode), `kkr.sync` |

## Set up the site (about 10 minutes)

1. **Repository.** On GitHub, create a new **private** repository called `brain-rewire`. Upload everything in this folder: `wrangler.jsonc`, `worker.js`, the `public` folder (and `src`, `build.py`, `test` if you want the source too).
2. **Worker.** In Cloudflare: **Workers & Pages → Create → Import a repository →** pick `brain-rewire`. Keep the deploy command `npx wrangler deploy`. The Worker name must be `brain-rewire` (the same as `"name"` in `wrangler.jsonc`).
3. **PIN.** Worker → **Settings → Runtime variables and secrets** (near Bindings) → **Add** → Type **Secret** → name `PIN` → your digits. Not the "Variables and secrets" under **Build**: the running app can't see those.
4. **Check.** Open `https://brain-rewire.emile-cao.workers.dev/api/ping`.
   - `"error":"pin"` means it's working.
   - `"error":"setup"` says what's missing (the database link or the PIN).
5. **Phone.** Open `https://brain-rewire.emile-cao.workers.dev` in Chrome. Tap ⋮ → **Add to Home screen**. In Kokoro go to **Settings → Cloud sync**, enter your PIN and tap **Connect**. After the first visit it opens without internet too.

The database link lives in `wrangler.jsonc`, so a deploy from GitHub keeps it. The PIN secret also survives deploys.

## Bring over your old data (once)

1. Put `public/export-old-data.html` on your phone, in the same place as your old tools.
2. Open it **the same way you open the old tools**. It shows what it found: Kokoro people, boundary-map dots, Stress Test thoughts and sessions.
3. Tap **Save the file**.
4. In Kokoro: **Settings → Import**, pick the file, tap **Merge**.
   - Map dots with the same name as a Kokoro person become that person's place on the map.
   - Old action scores become levels: Hurtful stays Hurtful, Neutral stays Neutral, Helpful becomes Good, Inspiring stays Inspiring.
   - The open Stress Test session stays open.

**If the helper finds nothing**, your phone keeps each old tool's data with its own file. Then, in each old tool:
1. Tap the address bar and type `javascript:` yourself.
2. Paste the line shown in the helper right after it and tap Go.
3. Import the saved `kokoro-old-data.json` the same way.

Your old tools are never changed.

## Using it without the site

`public/kokoro.html` also works as a single file opened straight from the phone, saving only on that phone. In that case, Cloud sync asks for the site address.

## Changing the code

- Edit the files in `src/`, then run `python3 build.py`. It writes `public/kokoro.html`.
- Tests are in `test/`:
  - `server.mjs` runs `worker.js` with a fake D1 on port 8787.
  - The `t_*.py` files are Playwright tests.
  - `t_wrangler.py` runs against `wrangler dev` on port 8788.
