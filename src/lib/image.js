export async function compressImageFile(file, options = {}) {
  const maxSize = options.maxSize || 1600
  const quality = options.quality || 0.72

  if (!file?.type?.startsWith('image/')) return file

  const imageUrl = URL.createObjectURL(file)
  const image = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = imageUrl
  })

  const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(imageUrl)

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) return file

  const cleanName = file.name.replace(/\.[^.]+$/, '') || 'foto'
  return new File([blob], `${cleanName}.jpg`, { type: 'image/jpeg' })
}
