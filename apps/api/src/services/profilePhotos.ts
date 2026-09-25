import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config.js';
import { AppError } from '../errors.js';

const configured = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

if (configured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

export async function uploadProfilePhoto(userId: string, dataUri: string) {
  if (!configured) {
    throw new AppError('Загрузка фотографий временно не настроена', 503, 'CLOUDINARY_NOT_CONFIGURED');
  }
  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      public_id: `poker-club/profiles/${userId}`,
      overwrite: true,
      invalidate: true,
      resource_type: 'image',
      format: 'webp',
      transformation: [
        { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
        { quality: 'auto:good', fetch_format: 'webp' }
      ]
    });
    return { url: result.secure_url, publicId: result.public_id };
  } catch (cause) {
    console.error('Cloudinary profile upload failed', cause);
    throw new AppError('Не удалось загрузить фотографию. Попробуйте ещё раз.', 502, 'PROFILE_PHOTO_UPLOAD_FAILED');
  }
}

export async function deleteProfilePhoto(publicId: string | null) {
  if (!configured || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'image' });
  } catch (cause) {
    console.error('Cloudinary profile delete failed', cause);
  }
}
