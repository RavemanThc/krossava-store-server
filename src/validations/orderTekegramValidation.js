import { Joi, Segments } from 'celebrate';

const customer = {
  firstname: Joi.string().trim().min(2).max(30).required(),
  lastname: Joi.string().trim().min(2).max(30).required(),
  socialMedia: Joi.string().trim().min(2).max(50).required(),
};

export const orderSchema = {
  [Segments.BODY]: Joi.alternatives().try(
    Joi.object({
      customer: Joi.object(customer).required(),
      items: Joi.array().min(1).max(50).items(Joi.object({
        name: Joi.string().trim().max(200).required(),
        barcode: Joi.string().trim().max(100).required(),
        size: Joi.string().trim().max(20).required(),
        quantity: Joi.number().integer().min(1).max(99).required(),
        price: Joi.number().min(0).max(1000000).precision(2).required(),
      })).required(),
    }),
    // Older product pages submit a single item without a cart.
    Joi.object({
      ...customer,
      productTitle: Joi.string().trim().max(200).required(),
      productSize: Joi.string().trim().max(20).required(),
      productBarcode: Joi.string().trim().max(100).required(),
      productImage: Joi.string().max(2048).allow('', null),
    }),
  ).required(),
};
