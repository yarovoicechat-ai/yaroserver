import express from 'express';
import { verifyToken } from '../middlewares/authorize.middleware';
import {
    getSegments,
    getSegmentById,
    createSegment,
    updateSegment,
    deleteSegment,
    previewSegmentCount,
    getSegmentUsersList
} from '../controllers/segmentController';

const router = express.Router();

router.get('/segments', verifyToken, getSegments);
router.get('/segments/:id', verifyToken, getSegmentById);
router.post('/segments', verifyToken, createSegment);
router.patch('/segments/:id', verifyToken, updateSegment);
router.delete('/segments/:id', verifyToken, deleteSegment);
router.post('/segments/preview-count', verifyToken, previewSegmentCount);
router.get('/segments/:id/users', verifyToken, getSegmentUsersList);

export default router;
