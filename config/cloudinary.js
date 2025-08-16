import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

export const deleteImage = async (publicId) => {
    if (!publicId) return { result: 'no_public_id' }

    try {
        const result = await cloudinary.uploader.destroy(publicId)
        if (result.result === 'ok') {
            console.log('Image deleted successfully:', publicId);
            return { success: true, message: 'Image deleted successfully' };
        } else {
            return { success: false, message: 'Image not found or failed to delete' };
        }
    } catch (err) {
        return { success: false, error: err.message }
    }
}

