import { Joi, Segments } from 'celebrate';

export const orderSchema = {
  [Segments.BODY]: Joi.object({
    firstname: Joi.string().trim().min(2).max(30).required().messages({
      'string.empty': "Ім'я не може бути пустим",
      'string.min': "Ім'я має містити мінімум {#limit} символи",
      'any.required': "Ім'я є обов'язковим полем",
    }),
    lastname: Joi.string().trim().min(2).max(30).required().messages({
      'string.empty': 'Прізвище не може бути пустим',
      'string.min': 'Прізвище має містити мінімум {#limit} символи',
      'any.required': "Прізвище є обов'язковим полем",
    }),
    socialMedia: Joi.string().trim().min(3).required().messages({
      'string.empty': 'Контактні дані не можуть бути пустими',
      'any.required': "Контактні дані є обов'язковими",
    }),
    productTitle: Joi.string().required(),
    productSize: Joi.string().required(),
    productBarcode: Joi.string().required(),
    productImage: Joi.string().allow('', null),
  }),
};
