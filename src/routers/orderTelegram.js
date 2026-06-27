import { Router } from 'express';
import { createOrder } from '../controllers/orderTelegram.js';
import { celebrate } from 'celebrate';
import { orderSchema } from '../validations/orderTekegramValidation.js';

const router = Router();

router.post('/orders', celebrate(orderSchema), createOrder);

export default router;
