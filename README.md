# Ludomania

Online Danish Ludo. Rules are in [RULES.md](RULES.md), the visual spec in [DESIGN.md](DESIGN.md).

## Run it

```
npm install
npm start
```

Then open http://localhost:3000. Run the tests with `npm test`.

## Accounts and statistics

Players log in with a username and password. Finished games count towards the player's games played and wins, and there is a leaderboard.

The server reads two settings from the environment:

| Setting | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string (for example from Supabase). Without it the server uses an in-memory store, so accounts disappear when it restarts. Fine for local development only. |
| `SESSION_SECRET` | A long random string that signs login cookies. Without it everyone is logged out whenever the server restarts. |

On Render, add both under **Environment**. For local runs you can put them in a file called `.env` in the project folder. That file is ignored by Git and must never be committed. Never put passwords in any other file in the project.

Generate a secret with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The `users` table is created automatically on first start.
