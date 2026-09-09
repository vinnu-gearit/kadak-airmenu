// Cloudinary image uploads. Configured from env; if not configured, uploads
// return a clear error so the rest of the app still runs.
import { v2 as cloudinary } from 'cloudinary';

let configured = false;
export function initCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_URL } = process.env;
  if (CLOUDINARY_URL) { configured = true; return; } // SDK reads CLOUDINARY_URL automatically
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET });
    configured = true;
  }
}
export function isCloudinaryConfigured() { return configured; }

// Upload a Buffer, return the secure URL.
export function uploadBuffer(buffer, folder = 'kadak-airmenu') {
  return new Promise((resolve, reject) => {
    if (!configured) return reject(new Error('Cloudinary is not configured on the server.'));
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ width: 900, height: 900, crop: 'limit' }, { quality: 'auto' }] },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}
