import { body } from "express-validator";

const sanitizePhoneNumber = (val: any) => {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  // Strip leading 0 after country code (e.g. +920300... -> +92300..., +880017... -> +88017...)
  return trimmed.replace(/^(\+\d{1,4})0+(\d{6,})$/, "$1$2");
};

export const validationCheckUser = [
  body("phoneNumber")
    .notEmpty()
    .withMessage("Phone number is required")
    .customSanitizer(sanitizePhoneNumber)
    .isMobilePhone("any")
    .withMessage("Invalid phone number format"),
];

export const validationResetPassword = [
  body("phoneNumber")
    .notEmpty()
    .withMessage("Phone number is required")
    .customSanitizer(sanitizePhoneNumber)
    .isMobilePhone("any")
    .withMessage("Invalid phone number format"),

  body("newPassword")
    .notEmpty()
    .withMessage("New Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),

    body("firebaseIdToken")
      .notEmpty()
      .withMessage("Firebase phone verification is required"),
];

export const validationUserCreate = [
  body("phoneNumber")
    .notEmpty()
    .withMessage("Phone number is required")
    .customSanitizer(sanitizePhoneNumber)
    .isMobilePhone("any")
    .withMessage("Invalid phone number format"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),

    body("firebaseIdToken")
      .notEmpty()
      .withMessage("Firebase phone verification is required"),

  body("age")
    .notEmpty()
    .withMessage("Age is required to register")
    .isInt({ min: 18, max: 120 })
    .withMessage("You must be at least 18 years old to register on Yaro"),
];

export const validationUserLogin = [
  body("phoneNumber")
    .optional()
    .customSanitizer(sanitizePhoneNumber)
    .isString()
    .withMessage("Invalid phone number or user identifier format"),

  body("userId")
    .optional()
    .isString()
    .trim()
    .withMessage("User ID must be a valid string"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];

export const validationGoogleAuth = [
  body("googleIdToken")
    .notEmpty()
    .withMessage("Google ID token is required")
    .isString()
    .withMessage("Google ID token must be a string"),

  // You might optionally want to validate deviceId if you always expect it
  body("deviceId")
    .optional()
    .isString()
    .withMessage("Device ID must be a string"),

  body("age")
    .optional()
    .isInt({ min: 18, max: 120 })
    .withMessage("You must be at least 18 years old to register on Yaro"),
];
