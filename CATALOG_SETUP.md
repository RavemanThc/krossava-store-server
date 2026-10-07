# Catalog administration

Set `ADMIN_API_KEY` to a long random secret on the server. Send it as `Authorization: Bearer <key>` for POST /sneackers, PATCH /sneackers/:id and DELETE /sneackers/:id. Never expose this key in NEXT_PUBLIC variables. Without this setting, catalog writes return 503; public reading remains available.

After deployment, run `node scripts/importToAlgolia.js` once to refresh existing indexed stock data. Product updates and supplier imports now synchronize Algolia automatically. A sync failure is reported as an error; retry the synchronization script if the database change already succeeded.

POST /chat performs catalog search; it does not call an AI provider. Telegram order handling is unchanged.
