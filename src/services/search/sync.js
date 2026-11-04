import { algoliaClient, INDEX_NAME } from '../../config/algolia.js';
import { mapProductToAlgolia } from '../../mappers/algoliaMapper.js';
import { upsertTypesenseProducts, deleteTypesenseProducts } from './typesense.js';

// Each provider is attempted even if the other fails. A failed snapshot is
// reported and retried on the next catalogue run before MongoDB deletions.
export async function syncSearchProducts(products, removedIds = [], providers) {
  const tasks = providers || [
    async () => {
      if (removedIds.length) await algoliaClient.deleteObjects({ indexName: INDEX_NAME, objectIDs: removedIds, waitForTasks: true });
      if (products.length) await algoliaClient.saveObjects({ indexName: INDEX_NAME, objects: products.map(mapProductToAlgolia), waitForTasks: true });
    },
    async () => {
      await deleteTypesenseProducts(removedIds);
      await upsertTypesenseProducts(products);
    },
  ];
  const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task)));
  const failed = results.map((result, i) => result.status === 'rejected' ? ['Algolia', 'Typesense'][i] : null).filter(Boolean);
  if (failed.length) throw new Error(`Search replication failed: ${failed.join(', ')}`);
}
