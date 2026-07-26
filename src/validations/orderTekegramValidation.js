import { Joi, Segments } from 'celebrate';

export const orderSchema = {
  [Segments.BODY]: Joi.object({
    customer: Joi.object({
      firstname: Joi.string().trim().min(2).max(30).required(),
      lastname: Joi.string().trim().min(2).max(30).required(),
      socialMedia: Joi.string().trim().min(3).required(),
    }).required(),

    items: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().required(),
          barcode: Joi.string().required(),
          price: Joi.number().required(),
          size: Joi.string().required(),
          quantity: Joi.number().integer().min(1).required(),
        }),
      )
      .min(1)
      .required(),
  }),
};
