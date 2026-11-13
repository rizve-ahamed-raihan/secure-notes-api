import express from 'express';
import { createPost, getAllPosts } from '../controllers/postController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public route to view posts
router.get('/', getAllPosts);

// Authenticated route to create post
router.post('/', protect, createPost);

export default router;
