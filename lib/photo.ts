// Decoding into a canvas bakes phone EXIF orientation into the stored pixels.
// The same compressed image is used for mapping, storage, and reopening.
export async function preparePhoto(file: File): Promise<Blob> {
  if (file.size > 30 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 30 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(
        "This photo could not be opened. Try a JPEG, PNG, or WebP photo. For HEIC, export it as JPEG first.",
      );
    }
    const scale = Math.min(
      1,
      2000 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not prepare this photo.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not prepare photo.")),
        "image/jpeg",
        0.88,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
