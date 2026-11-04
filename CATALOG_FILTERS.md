# Category-dependent filters

Brand categories select the brand across supplier categories and expose Model + Size.
Other categories retain their supplier category and expose Brand + Model + Size.
Model is enabled after a brand is selected. Options/counts are calculated by Algolia
for the active category, search and sibling filters, excluding sold-out sizes.

Brand and model are derived by `src/services/catalog/classification.js` whenever a
product is indexed (including the daily Easydrop import). Unknown models remain
blank; their products remain accessible by brand/size. Extend the reviewed model
families when new supplier naming conventions appear.

## Release order

1. Publish the backend changes to the repository used by Render and GitHub Actions.
2. With the existing MongoDB/Algolia environment, run `npm run configure:filters`.
   It preserves unrelated index settings, enables facets and reindexes MongoDB
   products. It does not delete products or photos. Stop if this step fails.
3. Deploy the backend, then deploy the frontend. No new environment variables.

The index was configured against 1,897 products during local verification.
Until the new mapper is published, an older daily workflow can overwrite the new
brand/model/inStock fields. Re-run configuration after deploying if that occurs.

Price sorting requires the pre-existing optional `sneakers_index_price_asc` and
`sneakers_index_price_desc` replicas. They were absent during verification; this
feature does not create them or add a price-sort selector.

Local verification: Node tests, frontend TypeScript and focused ESLint checks;
real Algolia queries and browser checks of Nike, Thermo, Thermo/New Balance/9060.
