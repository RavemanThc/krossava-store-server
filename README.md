# Krossava — Catalog API & Synchronization

The backend for [Krossava](https://krossava.com.ua), a Ukrainian sneaker store. Built with **Node.js, Express 5, MongoDB and Algolia**, it serves the storefront, delivers order notifications and synchronizes product data across supplier, search and image-storage services.

The main engineering problem is keeping stock, product identity and photos consistent when those records originate from different systems.

[Frontend repository](https://github.com/RavemanThc/krossava-store-front) · [Author: Vlad Harkusha](https://github.com/RavemanThc)

## What this service does

- Serves paginated catalog results with category, brand, model, size and price filters.
- Calculates contextual filter options and counts from Algolia.
- Returns product details and recently viewed products through a shared response mapper.
- Exposes cursor-based product traversal for sitemap generation.
- Validates orders and sends notifications through a Telegram bot.
- Imports supplier prices, descriptions, main images and available sizes from Easydrop.
- Matches Telegram discussion photos to products by normalized SKU and uploads galleries to Cloudflare R2.
- Removes unavailable products and their unshared gallery assets, with retryable cleanup.

## Architecture and data ownership

```mermaid
flowchart TD
    Feed[Easydrop XML] --> Plan[Validate feed and build synchronization plan]
    Plan --> DB[(MongoDB product catalog)]
    DB --> Mapper[Shared product-to-search mapper]
    Mapper --> Search[Algolia index]
    Telegram[Telegram discussion comments] --> Match[Normalize SKU and select first 10 photos]
    Match --> Cloudflare R2[Cloudflare R2 galleries]
    Cloudflare R2 --> DB
    API[Express API] --> DB
    API --> Search
    API --> Bot[Telegram order bot]
    Actions[GitHub Actions daily job] --> Plan
    Actions --> Match
```

| Source | Owns |
| --- | --- |
| Easydrop | Product name, category, price, description, main photo and stock |
| Telegram supplier discussions | Additional gallery photos |
| MongoDB | Persisted product records, gallery references and cleanup queue |
| Algolia | Derived search records and filter facets |
| Cloudflare R2 | Uploaded gallery image assets |

A stock refresh does not overwrite the Telegram gallery. The order bot and the Telegram account used to read supplier discussions are separate integrations with separate credentials.

## Engineering highlights

### Dependent catalog filters

Brand categories fix the brand and expose model/size options. Seasonal and sale categories keep their category constraint and allow an additional brand selection. The API batches the product query and three facet queries in one Algolia request.

Each facet omits its own active selection while retaining the relevant parent/sibling constraints, so customers can change a selection without losing context. Sold-out sizes are excluded from indexed size facets. Brand and model classification is derived during indexing, including daily imports; unrecognized models are left blank.

See [filter implementation and release order](CATALOG_FILTERS.md).

### Reliable matching across sources

SKU normalization handles visually equivalent Cyrillic and Latin letters while preserving meaningful prefixes such as `MA` and `MB`. Photos must belong to the product's discussion thread; neighboring messages are not treated as evidence of a match.

The importer selects the first ten photo messages in chronological order, excludes the main post's image and deduplicates selected files by SHA-256. Ambiguous matches are reported. Gallery references are replaced only after the selected group has been successfully processed.

See [photo import and Telegram authorization](PHOTO_IMPORT.md).

### Controlled catalog deletion

Synchronization starts by validating the complete feed and calculating a change plan. Empty, malformed or suspiciously reduced feeds are blocked before applying catalog changes. The workflow prevents overlapping runs of the same scheduled job.

Cleanup protects shared image references and active product SKUs. Failed asset deletions are recorded in the MongoDB cleanup queue for a later retry. These safeguards matter because a supplier feed error must not silently empty the store.

### Explicit consistency boundaries

MongoDB, Algolia and Cloudflare R2 do not participate in one distributed transaction. A failure can occur after one system has already changed. Shared mapping, retryable cleanup, reports and reindexing commands support recovery; the application does not claim atomic updates across services.

## Stack

| Area | Implementation |
| --- | --- |
| HTTP service | Node.js ES modules, Express 5, CORS, Pino |
| Persistence | MongoDB, Mongoose |
| Validation | Celebrate / Joi |
| Search | Algolia JavaScript client |
| Supplier feed | XML parsing and catalog reconciliation |
| Image storage | Cloudflare R2 |
| Telegram | Bot API for orders; teleproto for authorized discussion access |
| Automation | GitHub Actions |
| Tests | Node's built-in test runner and mocks |

## Run locally

Use **Node.js 22 or newer**, npm, a MongoDB database and an Algolia application. Prefer development resources when evaluating the project: import commands can modify the configured services.

```bash
git clone https://github.com/RavemanThc/krossava-store-server.git
cd krossava-store-server
npm ci
```

Create a `.env` file in the project root. The values below are placeholders:

```dotenv
PORT=3100
NODE_ENV=development
MONGODB_URL=mongodb://127.0.0.1:27017/krossava
ALGOLIA_APP_ID=your-application-id
ALGOLIA_ADMIN_KEY=your-server-side-key
```

To populate a development catalog, set `EASYDROP_FEED_URL` and all five R2 variables from the environment reference below. Cloudflare R2 configuration is required by apply mode even for an initial import. Inspect the plan before applying it:

```bash
npm run sync:catalog
npm run sync:catalog -- --apply
npm run configure:filters
npm run dev
```

The `--apply` command updates products and can delete sold-out/missing products and associated assets. Review [synchronization setup](DAILY_SYNC.md) before applying the plan. `configure:filters` requires a nonempty MongoDB catalog and configures the `sneakers_index` facets before reindexing products.

Point the frontend's `NEXT_PUBLIC_API_URL` to `http://localhost:3100`. Use `npm start` to run the API without the development watcher.

### Environment reference

| Variables | Used for |
| --- | --- |
| `PORT`, `NODE_ENV` | Server port and error-response environment |
| `MONGODB_URL` | Product database and cleanup queue |
| `ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_KEY` | Server-side search/index access |
| `ADMIN_API_KEY` | Bearer authentication for catalog create/update/delete endpoints |
| `TG_API_KEY`, `TG_ID` | Order-notification bot and destination chat |
| `EASYDROP_FEED_URL` | Authorized supplier XML feed |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_PUBLIC_URL` | Gallery uploads and asset cleanup |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Telegram client application credentials |
| `TELEGRAM_SESSION` | Authorized account session for automated discussion access |

Local Telegram authorization can use `.telegram/session.txt` instead of the session environment variable. Follow [PHOTO_IMPORT.md](PHOTO_IMPORT.md) for login and export options. Never commit `.env`, Telegram sessions or live credentials, and never expose them through frontend `NEXT_PUBLIC_*` variables.

## API overview

The existing API uses the spelling **`/sneackers`**; clients must use that exact route.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/sneackers` | Paginated products and contextual facets |
| GET | `/sneackers/:id` | Product details |
| GET | `/categories` | Supplier categories |
| GET | `/sneackers/history?ids=<id>,<id>` | Recently viewed products, preserving requested order |
| GET | `/sitemap-products?after=<id>` | Up to 1,000 products plus a continuation cursor |
| POST | `/chat` | Chat-style Algolia catalog search |
| POST | `/orders` | Validate and deliver an order notification |
| POST | `/sneackers` | Create a product; administrator bearer key required |
| PATCH | `/sneackers/:id` | Update a product; administrator bearer key required |
| DELETE | `/sneackers/:id` | Delete a product; administrator bearer key required |

Catalog query parameters include `search`, `category`, `brand`, `model`, `size`, `minPrice`, `maxPrice`, `page` and `perPage` (maximum 50). The response includes `products`, pagination totals and `filters` with available options/counts.

```bash
curl --get http://localhost:3100/sneackers \
  --data-urlencode 'category=Термо' \
  --data-urlencode 'brand=New Balance' \
  --data-urlencode 'model=9060' \
  --data-urlencode 'size=42'
```

Price sorting through `sortBy=price&sortOrder=asc` or `desc` requires the corresponding Algolia replica indexes. Those replicas are not created by the filter-configuration script. Other accepted sort keys do not configure independent Algolia ranking strategies.

`POST /chat` accepts a message and performs catalog search. No LLM provider, n8n workflow or Redis conversation-memory service is part of the current implementation. Orders are Telegram notifications, not a payment or fulfillment system.

## Automation and operations

The [daily workflow](.github/workflows/daily-catalog.yml) schedules synchronization at **00:00 Asia/Beirut**. GitHub may delay scheduled runs; this is not an exact-time guarantee.

```bash
npm run sync:daily             # Inspect the plan without applying changes
npm run sync:daily -- --apply  # Apply catalog, gallery and cleanup operations
```

The workflow installs dependencies, runs tests, executes synchronization and retains JSON reports for 14 days. Manual runs default to preview mode; scheduled runs apply changes. Configure repository secrets and publish the workflow to the default branch before expecting automation to run.

See [DAILY_SYNC.md](DAILY_SYNC.md) for setup, permissions, reports and recovery details. Avoid running a second independent cron job against the same catalog.

For brand/model filtering, deploy the matching mapper and API, run `npm run configure:filters`, then release the frontend. An older importer can overwrite newly indexed fields, so the scheduled workflow must use the updated code too.

## Tests

```bash
ALGOLIA_APP_ID=test-app ALGOLIA_ADMIN_KEY=test-key npm test
```

Tests use fixtures and mocks for external services. They cover:

- Partial-feed and mass-deletion safeguards; retryable asset cleanup and shared-photo protection.
- SKU normalization, nested replies, album matching, duplicate photos and path traversal protection.
- Product response contracts, stock facets, filter constraints and request validation.
- Administrator authorization, sitemap cursors and recently viewed ordering.
- Order validation, Telegram confirmation and failure handling.

These checks do not replace smoke tests against configured integrations. There is no claimed test-coverage percentage or performance benchmark.

## Repository guide

```text
src/
  controllers/       Catalog, sitemap, search and order handlers
  routers/           Public and administrator routes
  models/            MongoDB schema and search synchronization hooks
  mappers/           Public response and Algolia record contracts
  validations/       Request schemas
  services/catalog/  Brand/model classification and facet queries
  services/import/   Feed reconciliation, SKU matching and asset handling
  services/telegram/ Authorized Telegram client setup
scripts/             Import, authorization, reindexing and daily orchestration
tests/               Regression and API-contract tests
.github/workflows/   Daily synchronization workflow
```

## Further documentation

- [Daily synchronization](DAILY_SYNC.md)
- [Photo import and Telegram access](PHOTO_IMPORT.md)
- [Dependent filters and deployment](CATALOG_FILTERS.md)
- [Catalog administration](CATALOG_SETUP.md)

## Author and scope

**Vlad Harkusha** — [GitHub](https://github.com/RavemanThc)

The project demonstrates REST API design, integration of independent data sources, search indexing and operational recovery. Customer accounts, online payments and an administrator dashboard are outside the current implementation.

`package.json` declares ISC; the repository currently has no standalone license file. Confirm distribution terms with the author before reusing it.


See [R2 migration and release checklist](R2_MIGRATION.md) for copying existing Cloudinary photos, enabling the delivery domain and retaining legacy cleanup credentials during the transition.
