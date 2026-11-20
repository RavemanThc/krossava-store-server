export const mapProductToDTO = (product) => {
  const id = product._id ? product._id.toString() : product.objectID;

  const mappedSizes =
    (product.stock || product.sizes)?.map((s) => {
      const sizeValue = typeof s === 'object' && s !== null ? s.size : s;
      const quantityValue =
        typeof s === 'object' && s !== null ? s.quantity : 1; // дефолт для Algolia

      return {
        size: sizeValue,
        quantity: quantityValue,
      };
    }) || [];

  return {
    id,
    groupId: product.groupId,
    name: product.name || product.title,
    image: product.image || product.images?.[0],
    title: product.name || product.title, // На случай, если в Algolia поле называется title
    category: product.category,
    price: product.price,
    images: [...new Set([
      product.image,
      ...(product.images || []),
      ...(product.telegramPhotos || []).map(photo => photo.url),
    ].filter(Boolean))],
    description: product.description,
    sizes: mappedSizes,
    sizeChart: (product.sizeChart?.rows || []).map(row => ({ size: row.size, cm: row.cm })),
    updatedAt: product.lastSyncAt || product.updatedAt,
    barcode: product.barcode,
  };
};
