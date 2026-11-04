# Cloudflare R2 photo storage

New comment-photo imports upload to R2 through the S3-compatible API. Easydrop
still supplies the main image, prices, descriptions and stock. First-ten-comment
selection, SKU matching and gallery order remain unchanged.

## Configuration

Set these in the server `.env` and the daily workflow's GitHub Actions Secrets:

```dotenv
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_R2_BUCKET_NAME=<bucket-name>
CLOUDFLARE_R2_ACCESS_KEY_ID=<r2-access-key-id>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
CLOUDFLARE_R2_PUBLIC_URL=https://img.krossava.com.ua
```

The R2 credentials need object read/write/delete and list access to the target
bucket. `CLOUDFLARE_ACCOUNT_API` is a management token and is not used for these
S3 operations. Never expose either kind of credential in frontend variables.

Connect the delivery domain to the bucket in Cloudflare. A private S3 endpoint
is not a public image URL. The frontend image allowlist includes
`img.krossava.com.ua/krossava/telegram/**`; update it if the domain changes.

Objects use `krossava/telegram/<SKU>/<SHA-256>` keys with image Content-Type and
immutable caching. MongoDB records use `r2:<object-key>` as their `publicId` to
keep R2 and old Cloudinary references unambiguous, even with the same object key.

## Copy existing galleries

```bash
# Inspect remaining Cloudinary references without uploading or changing products.
npm run migrate:photos:r2 -- --export .telegram/comments-export

# Upload and verify public delivery; keep existing product URLs unchanged.
npm run migrate:photos:r2 -- --export .telegram/comments-export --apply

# After BOTH applications and the workflow support R2, switch product references.
npm run migrate:photos:r2 -- --export .telegram/comments-export --apply --switch-links
```

Use `--limit 1` for a single-gallery check. Upload concurrency defaults to 8 and can be set with `--concurrency 16` (maximum 48). Use `--retry-report sync-reports/r2-migration-<timestamp>.json` to retry only products that failed in an earlier run. `--export` is optional: without it,
images are downloaded from their existing Cloudinary URLs. If those URLs return
401 or are otherwise unavailable, supply the saved Telegram export. Local files
must match the stored hash. The script preserves existing selection and order;
it does not select neighboring posts or different discussion threads.

Uploads are resumable by deterministic keys. Each product switches only after
all its photos have been uploaded and their public URLs verified. Concurrent
gallery changes cause a conflict instead of being overwritten. Failures and
conflicts result in a nonzero exit status. Reports are saved under
`sync-reports/r2-migration-<timestamp>.json` and include old/new asset IDs.

The migration does **not** delete old Cloudinary assets. Keep them until the
release and image delivery have been checked. It also does not automatically
publish code or update GitHub Secrets.

## Release order

1. Add the R2 secrets to GitHub Actions and the server environment used for imports.
2. Deploy the frontend with the R2 delivery-domain allowlist. Existing Cloudinary
   and Easydrop URLs stay supported during migration.
3. Publish the backend and daily workflow changes; avoid running an old importer
   concurrently with migration. The old cleanup code cannot interpret `r2:` IDs.
4. Copy photos, verify reports, then run the `--switch-links` command.
5. Check product galleries and run a preview of daily synchronization.

Keep the three `CLOUDINARY_*` secrets during transition if legacy assets still
need deletion. The cleanup adapter routes each ID to its original provider and
protects shared references. A missing legacy credential does not authorize
skipping a deletion: the durable queue remains for retry. The catalog report exposes `cleanupPending`; cleanup failures are warnings so that an unavailable legacy provider does not block importing new R2 galleries. Old Cloudinary orphans
are discovered for legacy/mixed cleanup entries only while legacy credentials remain configured. R2-only entries do not contact Cloudinary.

## Verification

Run `npm test`. Storage tests use an injected S3 client and cover MIME detection,
credential validation, safe IDs, idempotent upload, pagination, error redaction
and provider-aware cleanup. A real upload/public-URL check is also required before
switching production links.

References: [Cloudflare S3 SDK setup](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
[public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).


## Recover unavailable Cloudinary source files

When a migration report contains source errors and the old local export does not
contain those messages, recover the exact saved Telegram references:

```bash
node scripts/recoverMigrationPhotos.js --report sync-reports/r2-migration-<timestamp>.json
npm run migrate:photos:r2 -- --export .telegram/r2-recovery --retry-report sync-reports/r2-migration-<timestamp>.json --apply
```

Recovery uses only the linked discussion of `black_owl_partners`, verifies the
saved SHA-256 and never changes the product's photo selection. Original messages
that were removed or changed are reported rather than replaced by other photos.
Recovered files and a checkpointed report are stored in `.telegram/r2-recovery`.
For the final link switch, pass both exports (repeatable `--export`):

```bash
npm run migrate:photos:r2 -- --export .telegram/comments-export --export .telegram/r2-recovery --replacements .telegram/r2-recovery/replacements.json --apply --switch-links
```

### Explicitly approved changed Telegram files

If all Telegram variants differ from the saved hash, do not disable hash checks.
After verifying the post SKU and reply chain and obtaining approval to use the
current image, supply `--replacements .telegram/r2-recovery/replacements.json`.
The JSON array binds each replacement to `productId`, `sourceChatId`,
`sourceMessageId`, `sourceThreadId`, `article`, `oldSha256` and the new `sha256`.
The migration checks all bindings and the actual file bytes, then stores the new
hash in both the R2 key and gallery metadata. Duplicate entries are rejected.
Without this explicit option, changed files continue to fail verification.
Keep this manifest with the recovery export for the eventual link switch.
