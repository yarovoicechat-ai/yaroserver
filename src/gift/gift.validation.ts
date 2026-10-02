import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import sendResponse from '../utils/reponse';

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    return sendResponse(res, 400, false, firstError.msg, { errors: errors.array() });
  }
  next();
};

export const validateSendGift = [
  body('giftId')
    .notEmpty()
    .withMessage('giftId is required')
    .isString()
    .withMessage('giftId must be a valid ID'),
  body('requestId')
    .notEmpty()
    .withMessage('requestId is required for idempotency protection')
    .isString()
    .withMessage('requestId must be a unique string token'),
  body('quantity')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('quantity must be between 1 and 1000'),
  body('comboCount')
    .optional()
    .isInt({ min: 1 })
    .withMessage('comboCount must be an integer >= 1'),
  handleValidationErrors,
];

export const validateCreateGift = [
  body('name').trim().notEmpty().withMessage('Gift name is required'),
  body('icon').trim().notEmpty().withMessage('Gift icon is required'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('price must be a positive number'),
  body('cost')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('cost must be a positive number'),
  body('animationType')
    .optional()
    .isIn([
      'NORMAL',
      'FLOATING',
      'FLY_TO_RECEIVER',
      'CENTER_STAGE',
      'FULL_SCREEN',
      'SPECIAL',
      'VIP',
      'LUXURY',
    ])
    .withMessage('Invalid animationType'),
  body('rarity')
    .optional()
    .isIn(['common', 'rare', 'epic', 'legendary'])
    .withMessage('Invalid rarity'),
  handleValidationErrors,
];

export const validateCategory = [
  body('name').trim().notEmpty().withMessage('Category name is required'),
  handleValidationErrors,
];
