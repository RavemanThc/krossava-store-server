import { v2 as cloudinary } from 'cloudinary';

export function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary credentials are missing.');
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
  return cloudinary;
}

export async function uploadPhoto(file, article, sha256) {
  const client = configureCloudinary();
  const result = await client.uploader.upload(file, {
    resource_type: 'image',
    public_id: `krossava/telegram/${article}/${sha256}`,
    overwrite: false,
    unique_filename: false,
    timeout: 60000,
  });
  if (!result.secure_url?.startsWith('https://res.cloudinary.com/')) throw new Error('Cloudinary did not return a secure image URL.');
  return { url: result.secure_url, publicId: result.public_id };
}
