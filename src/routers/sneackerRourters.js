import { requireAdmin } from '../middlewares/requireAdmin.js';
import { getHistory, getSitemapProducts, chat } from '../controllers/catalogExtras.js';
import { Router } from 'express';
import {
  getSneackers,
  getSneackerById,
  createNewSneacker,
  deleateSneackerItem,
  pathSneackerItem,
  getCategories,
} from '../controllers/sneackerControllers.js';
import { celebrate } from 'celebrate';
import {
  getSneackersSchema,
  createSneackersSchema,
  sneackersIdParamSchema,
  updateSneackersSchema,
} from '../validations/studentsValidation.js';

const router = Router();

router.get('/sneackers', celebrate(getSneackersSchema), getSneackers);
router.get('/sneackers/history', getHistory);
router.get('/sitemap-products', getSitemapProducts);
router.post('/chat', chat);
router.get('/categories', getCategories);

router.get(
  '/sneackers/:id',
  celebrate(sneackersIdParamSchema),
  getSneackerById,
);
router.post('/sneackers', requireAdmin, celebrate(createSneackersSchema), createNewSneacker);
router.delete(
  '/sneackers/:id',
  requireAdmin,
  celebrate(sneackersIdParamSchema),
  deleateSneackerItem,
);
router.patch(
  '/sneackers/:id',
  requireAdmin,
  celebrate(updateSneackersSchema),
  pathSneackerItem,
);

export default router;
