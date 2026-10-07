export const mapProductToAlgolia = (doc) => ({
  objectID: String(doc._id), groupId: doc.groupId, name: doc.name,
  category: doc.category, price: doc.price, image: doc.image,
  description: doc.description, barcode: doc.barcode, updatedAt: doc.updatedAt,
  sizes: (doc.sizes || []).filter(s => s.quantity > 0).map(s => s.size),
  stock: (doc.sizes || []).map(s => ({ size: s.size, quantity: s.quantity })),
});
