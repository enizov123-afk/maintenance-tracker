/**
 * Сжимает изображение на клиенте через Canvas API.
 * Масштабирует до max 1200px по длинной стороне, конвертирует в JPEG quality 0.8.
 * Результат: ~200–400KB вместо 5–10MB с телефона.
 */
export async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      const MAX_SIDE = 1200
      let { width, height } = img

      if (width > MAX_SIDE || height > MAX_SIDE) {
        if (width > height) {
          height = Math.round((height * MAX_SIDE) / width)
          width = MAX_SIDE
        } else {
          width = Math.round((width * MAX_SIDE) / height)
          height = MAX_SIDE
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context unavailable'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('Compression failed'))
            return
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
              type: 'image/jpeg',
            })
          )
        },
        'image/jpeg',
        0.8
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}
