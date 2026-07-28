export const mapProductToDTO = (product) => {
  const id = product._id ? product._id.toString() : product.objectID;

  const mappedSizes =
    product.sizes?.map((s) => {
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

    title: product.name || product.title,
    name: product.name || product.title,

    category: product.category,
    price: product.price,

    image: product.image || product.images?.[0],

    images: product.image
      ? [product.image]
      : Array.isArray(product.images)
        ? product.images
        : [],

    description: product.description,
    sizes: mappedSizes,
    updatedAt: product.lastSyncAt || product.updatedAt,
    barcode: product.barcode,
  };
};
