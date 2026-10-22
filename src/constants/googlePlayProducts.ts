/**
 * Centralized Google Play Product Catalog for Yaro (Server-side)
 *
 * Immutable mapping of product ID to diamond entitlement and official INR price.
 * Server must ALWAYS derive diamond quantity from this catalog and never trust
 * client-supplied price or diamond amounts.
 */

export interface GooglePlayProductConfig {
  productId: string;
  diamonds: number;
  priceInr: number;
  formattedPrice: string;
}

export const GOOGLE_PLAY_PRODUCTS: Record<string, GooglePlayProductConfig> = {
  // --- Current 9 Plans ---
  diamonds_7: {
    productId: 'diamonds_7',
    diamonds: 7,
    priceInr: 10,
    formattedPrice: '₹10',
  },
  diamonds_35: {
    productId: 'diamonds_35',
    diamonds: 35,
    priceInr: 49,
    formattedPrice: '₹49',
  },
  diamonds_71: {
    productId: 'diamonds_71',
    diamonds: 71,
    priceInr: 99,
    formattedPrice: '₹99',
  },
  diamonds_143: {
    productId: 'diamonds_143',
    diamonds: 143,
    priceInr: 199,
    formattedPrice: '₹199',
  },
  diamonds_215: {
    productId: 'diamonds_215',
    diamonds: 215,
    priceInr: 299,
    formattedPrice: '₹299',
  },
  diamonds_359: {
    productId: 'diamonds_359',
    diamonds: 359,
    priceInr: 499,
    formattedPrice: '₹499',
  },
  diamonds_719: {
    productId: 'diamonds_719',
    diamonds: 719,
    priceInr: 999,
    formattedPrice: '₹999',
  },
  diamonds_1439: {
    productId: 'diamonds_1439',
    diamonds: 1439,
    priceInr: 1999,
    formattedPrice: '₹1,999',
  },
  diamonds_3599: {
    productId: 'diamonds_3599',
    diamonds: 3599,
    priceInr: 4999,
    formattedPrice: '₹4,999',
  },

  // --- Aliases for alternate SKU naming conventions ---
  yaro_diamonds_7: { productId: 'diamonds_7', diamonds: 7, priceInr: 10, formattedPrice: '₹10' },
  plan_1: { productId: 'diamonds_7', diamonds: 7, priceInr: 10, formattedPrice: '₹10' },
  yaro_diamonds_35: { productId: 'diamonds_35', diamonds: 35, priceInr: 49, formattedPrice: '₹49' },
  plan_2: { productId: 'diamonds_35', diamonds: 35, priceInr: 49, formattedPrice: '₹49' },
  yaro_diamonds_71: { productId: 'diamonds_71', diamonds: 71, priceInr: 99, formattedPrice: '₹99' },
  plan_3: { productId: 'diamonds_71', diamonds: 71, priceInr: 99, formattedPrice: '₹99' },
  yaro_diamonds_143: { productId: 'diamonds_143', diamonds: 143, priceInr: 199, formattedPrice: '₹199' },
  plan_4: { productId: 'diamonds_143', diamonds: 143, priceInr: 199, formattedPrice: '₹199' },
  yaro_diamonds_215: { productId: 'diamonds_215', diamonds: 215, priceInr: 299, formattedPrice: '₹299' },
  plan_5: { productId: 'diamonds_215', diamonds: 215, priceInr: 299, formattedPrice: '₹299' },
  yaro_diamonds_359: { productId: 'diamonds_359', diamonds: 359, priceInr: 499, formattedPrice: '₹499' },
  plan_6: { productId: 'diamonds_359', diamonds: 359, priceInr: 499, formattedPrice: '₹499' },
  yaro_diamonds_719: { productId: 'diamonds_719', diamonds: 719, priceInr: 999, formattedPrice: '₹999' },
  plan_7: { productId: 'diamonds_719', diamonds: 719, priceInr: 999, formattedPrice: '₹999' },
  yaro_diamonds_1439: { productId: 'diamonds_1439', diamonds: 1439, priceInr: 1999, formattedPrice: '₹1,999' },
  plan_8: { productId: 'diamonds_1439', diamonds: 1439, priceInr: 1999, formattedPrice: '₹1,999' },
  yaro_diamonds_3599: { productId: 'diamonds_3599', diamonds: 3599, priceInr: 4999, formattedPrice: '₹4,999' },
  plan_9: { productId: 'diamonds_3599', diamonds: 3599, priceInr: 4999, formattedPrice: '₹4,999' },

  // --- Legacy SKU fallbacks (ensure past transactions verify correctly) ---
  diamonds_800: { productId: 'diamonds_800', diamonds: 800, priceInr: 59, formattedPrice: '₹59' },
  diamonds_1350: { productId: 'diamonds_1350', diamonds: 1350, priceInr: 99, formattedPrice: '₹99' },
  diamonds_2700: { productId: 'diamonds_2700', diamonds: 2700, priceInr: 199, formattedPrice: '₹199' },
  diamonds_5400: { productId: 'diamonds_5400', diamonds: 5400, priceInr: 399, formattedPrice: '₹399' },
  diamonds_8100: { productId: 'diamonds_8100', diamonds: 8100, priceInr: 599, formattedPrice: '₹599' },
  diamonds_13500: { productId: 'diamonds_13500', diamonds: 13500, priceInr: 999, formattedPrice: '₹999' },
  diamonds_27000: { productId: 'diamonds_27000', diamonds: 27000, priceInr: 1999, formattedPrice: '₹1,999' },
  diamonds_67500: { productId: 'diamonds_67500', diamonds: 67500, priceInr: 4999, formattedPrice: '₹4,999' },
  diamonds_135000: { productId: 'diamonds_135000', diamonds: 135000, priceInr: 9999, formattedPrice: '₹9,999' },
};

export const GOOGLE_PLAY_PRODUCT_IDS = [
  'diamonds_7',
  'diamonds_35',
  'diamonds_71',
  'diamonds_143',
  'diamonds_215',
  'diamonds_359',
  'diamonds_719',
  'diamonds_1439',
  'diamonds_3599',
];

export const getProductConfig = (productId: string): GooglePlayProductConfig | null => {
  if (!productId) return null;
  return GOOGLE_PLAY_PRODUCTS[productId] || null;
};
