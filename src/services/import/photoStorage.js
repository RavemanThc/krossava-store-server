import { createR2Storage, assetKeyPattern } from './r2.js';
import { configureCloudinary } from './cloudinary.js';

// Existing unprefixed IDs belong to Cloudinary. R2 IDs are explicitly namespaced.
export function configurePhotoStorage({ r2 = createR2Storage(), legacy = configureCloudinary, hasLegacy = ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'].every(key=>process.env[key]) } = {}) {
  return {
    check: () => r2.check(),
    uploadPhoto: (...args) => r2.uploadPhoto(...args),
    async listAssets(prefix, knownIds = []) {
      const ids=await r2.listAssets(prefix);
      if(hasLegacy && (!knownIds.length || knownIds.some(id=>!id.startsWith('r2:')))) {
        const cloud=legacy(); let cursor;
        do {
          const page=await cloud.api.resources({type:'upload',resource_type:'image',prefix,max_results:500,...(cursor?{next_cursor:cursor}:{})});
          ids.push(...page.resources.map(asset=>asset.public_id)); cursor=page.next_cursor;
        } while(cursor);
      }
      return ids;
    },
    async destroy(id) {
      if(id.startsWith('r2:')) return r2.destroy(id);
      if(!assetKeyPattern.test(id)) throw new Error('Invalid legacy asset ID');
      // Missing legacy credentials leave the durable cleanup entry for a later retry.
      return legacy().uploader.destroy(id,{resource_type:'image',invalidate:true});
    },
  };
}
