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
    title: product.name || product.title, // На случай, если в Algolia поле называется title
    category: product.category,
    price: product.price,
    images: product.image
      ? [product.image]
      : Array.isArray(product.images)
        ? product.images
        : [], // подстраховка для массивов картинок
    description: product.description,
    sizes: mappedSizes,
    updatedAt: product.lastSyncAt || product.updatedAt,
    barcode: product.barcode,
  };
};
