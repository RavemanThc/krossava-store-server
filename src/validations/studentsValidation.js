import { Joi, Segments } from 'celebrate';
import { isValidObjectId } from 'mongoose';

export const createSneackersSchema = {
  [Segments.BODY]: Joi.object({
    groupId: Joi.string().required().messages({
      'any.required': 'groupId is required',
      'string.base': 'groupId must be a string',
    }),

    name: Joi.string().min(2).max(200).required().messages({
      'any.required': 'name is required',
      'string.min': 'name must be at least 2 characters',
      'string.max': 'name must be at most 200 characters',
    }),

    category: Joi.string().required().messages({
      'any.required': 'category is required',
    }),

    price: Joi.number().positive().required().messages({
      'any.required': 'price is required',
      'number.base': 'price must be a number',
      'number.positive': 'price must be greater than 0',
    }),

    image: Joi.string().uri().required().messages({
      'any.required': 'image is required',
      'string.uri': 'image must be a valid URL',
    }),

    description: Joi.string().allow('').optional().messages({
      'string.base': 'description must be a string',
    }),

    barcode: Joi.string().required().messages({
      'any.required': 'barcode is required',
    }),

    sizes: Joi.array()
      .items(
        Joi.object({
          size: Joi.string().required().messages({
            'any.required': 'size is required',
          }),

          quantity: Joi.number().integer().min(0).required().messages({
            'any.required': 'quantity is required',
            'number.min': 'quantity cannot be negative',
          }),

          itemId: Joi.string().required().messages({
            'any.required': 'itemId is required',
          }),
        }),
      )
      .min(1)
      .required()
      .messages({
        'array.base': 'sizes must be an array',
        'array.min': 'sizes must contain at least 1 item',
        'any.required': 'sizes is required',
      }),
  }),
};
export const getSneackersSchema = {
  [Segments.QUERY]: Joi.object({
    page: Joi.number().integer().min(1).default(1).messages({
      'number.base': 'page must be a number',
      'number.integer': 'page must be an integer',
      'number.min': 'page must be >= 1',
    }),

    perPage: Joi.number().integer().min(1).max(50).default(10).messages({
      'number.base': 'perPage must be a number',
      'number.min': 'perPage must be at least 1',
      'number.max': 'perPage must be at most 50',
    }),

    search: Joi.string().trim().allow('').messages({
      'string.base': 'search must be a string',
    }),

    category: Joi.string().trim().messages({
      'string.base': 'category must be a string',
    }),

    minPrice: Joi.number().min(0).messages({
      'number.base': 'minPrice must be a number',
      'number.min': 'minPrice cannot be negative',
    }),

    maxPrice: Joi.number().min(0).messages({
      'number.base': 'maxPrice must be a number',
      'number.min': 'maxPrice cannot be negative',
    }),

    size: Joi.string().trim().messages({
      'string.base': 'size must be a string',
    }),

    sortBy: Joi.string()
      .valid('_id', 'price', 'name', 'createdAt', 'updatedAt')
      .default('_id')
      .messages({
        'any.only':
          'sortBy must be one of _id, price, name, createdAt, updatedAt',
      }),

    sortOrder: Joi.string().valid('asc', 'desc').default('asc').messages({
      'any.only': "sortOrder must be 'asc' or 'desc'",
    }),
  }),
};

const objectIdValidator = (value, helpers) => {
  return !isValidObjectId(value) ? helpers.message('Invalid id format') : value;
};

export const sneackersIdParamSchema = {
  [Segments.PARAMS]: Joi.object({
    id: Joi.string().custom(objectIdValidator).required(),
  }),
};

export const updateSneackersSchema = {
  [Segments.PARAMS]: Joi.object({
    id: Joi.string().custom(objectIdValidator).required(),
  }),
  [Segments.BODY]: Joi.object({
    groupId: Joi.string().messages({
      'string.base': 'groupId must be a string',
    }),

    name: Joi.string().min(2).max(200).messages({
      'string.min': 'name must be at least 2 characters',
      'string.max': 'name must be at most 200 characters',
    }),

    category: Joi.string().messages({
      'string.base': 'category must be a string',
    }),

    price: Joi.number().positive().messages({
      'number.base': 'price must be a number',
      'number.positive': 'price must be > 0',
    }),

    image: Joi.string().uri().messages({
      'string.uri': 'image must be a valid URL',
    }),

    description: Joi.string().allow('').messages({
      'string.base': 'description must be a string',
    }),

    barcode: Joi.string().messages({
      'string.base': 'barcode must be a string',
    }),

    sizes: Joi.array()
      .items(
        Joi.object({
          size: Joi.string().required(),
          quantity: Joi.number().integer().min(0).required(),
          itemId: Joi.string().required(),
        }),
      )
      .messages({
        'array.base': 'sizes must be an array',
      }),
  })
    .min(1)
    .unknown(false),
};
