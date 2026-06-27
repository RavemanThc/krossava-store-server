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
  sneackersIdParamSchema,
  updateSneackersSchema,
} from '../validations/studentsValidation.js';

const router = Router();

router.get('/sneackers', getSneackers);
router.get('/categories', getCategories);

router.get(
  '/sneackers/:id',
  celebrate(sneackersIdParamSchema),
  getSneackerById,
);
router.post('/sneackers', celebrate(getSneackersSchema), createNewSneacker);
router.post(
  'sneackers/:id',
  celebrate(sneackersIdParamSchema),
  deleateSneackerItem,
);
router.post(
  'sneackers/:id',
  celebrate(updateSneackersSchema),
  pathSneackerItem,
);

export default router;
