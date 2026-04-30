# Beginner Task Board

This is a beginner-friendly web app built with Node.js, plain JavaScript, and SQLite.

## What it includes

- A small Node.js server using the built-in `http` module
- SQLite storage using Node's built-in `node:sqlite`
- Cookie-based login and account creation
- A JSON API for reading the board, adding columns, adding tasks, moving tasks, and deleting tasks
- A vanilla JavaScript frontend
- A one-time migration path from the older JSON files into `data/app.db`

## Run it

```powershell
.\start-app.ps1
```

If PowerShell blocks the script, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-app.ps1
```

You can also use:

```bat
start-app.cmd
```

Then open `http://127.0.0.1:3000`.

You can also set:

```powershell
$env:HOST="0.0.0.0"
$env:PORT="3000"
node server.js
```

If you want the SQLite database somewhere else, set:

```powershell
$env:DATA_DIR="C:\\some\\persistent\\folder"
node server.js
```

## Demo login

- Email: `demo@example.com`
- Password: `password123`

## Project structure

- `server.js`: server, routing, and API logic
- `public/index.html`: UI markup
- `public/app.js`: frontend behavior
- `public/login.html`: login and registration screen
- `public/login.js`: auth form behavior
- `public/styles.css`: styling
- `data/app.db`: SQLite database used by the app
- `data/board.json`, `data/users.json`, `data/sessions.json`: legacy JSON files used only as migration input for older projects

## Portfolio Deploy Notes

- The app now uses SQLite in `data/app.db`, so deploy it to a host that supports persistent disk storage.
- In production, set `NODE_ENV=production` so session cookies use the `Secure` flag.
- The database file is ignored in `.gitignore`; create it by starting the app on the server.

## Render Setup

- This repo now includes [render.yaml](C:/Users/John/Documents/Codex/2026-04-24/help-me-come-up-with-a-2/render.yaml) for a Render web service with a persistent disk.
- The app exposes `GET /health` for Render health checks.
- On Render, SQLite will live at `/var/data/app.db` because `DATA_DIR=/var/data` is set in `render.yaml`.
- The first startup can still import the starter board and demo user from the repo's `data/*.json` files, even when the live database is stored on the mounted disk.

Typical Render flow:

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Make sure the persistent disk is attached at `/var/data`.
4. Deploy and open `/login`.

Demo login after deploy:

- Email: `demo@example.com`
- Password: `password123`
