import { Router } from 'express';
import { userController } from './user.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';

const router = Router();

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/me', authMiddleware, userController.getMe);

/**
 * @swagger
 * /users/me:
 *   put:
 *     summary: Update current user profile
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
router.put('/me', authMiddleware, userController.updateMe);

/**
 * @swagger
 * /users/me:
 *   delete:
 *     summary: Soft-delete current user account
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
router.delete('/me', authMiddleware, userController.deleteMe);

export const userRoutes = router;
