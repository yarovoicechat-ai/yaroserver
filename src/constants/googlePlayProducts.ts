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

// Legacy entitlements above remain unchanged for recovery. Only these SKUs are public.
export const GOOGLE_PLAY_PRODUCT_IDS = ["diamonds_7", "diamonds_36","diamonds_72","diamonds_144","diamonds_360","diamonds_720","diamonds_1440","diamonds_3600","diamonds_7200"];
Object.assign(GOOGLE_PLAY_PRODUCTS, {"diamonds_36": {productId: "diamonds_36", diamonds: 36, priceInr: 50, formattedPrice: "INR 50"},"diamonds_72":{"productId":"diamonds_72","diamonds":72,"priceInr":100,"formattedPrice":"INR 100"},"diamonds_144":{"productId":"diamonds_144","diamonds":144,"priceInr":200,"formattedPrice":"INR 200"},"diamonds_360":{"productId":"diamonds_360","diamonds":360,"priceInr":500,"formattedPrice":"INR 500"},"diamonds_720":{"productId":"diamonds_720","diamonds":720,"priceInr":1000,"formattedPrice":"INR 1000"},"diamonds_1440":{"productId":"diamonds_1440","diamonds":1440,"priceInr":2000,"formattedPrice":"INR 2000"},"diamonds_3600":{"productId":"diamonds_3600","diamonds":3600,"priceInr":5000,"formattedPrice":"INR 5000"},"diamonds_7200":{"productId":"diamonds_7200","diamonds":7200,"priceInr":10000,"formattedPrice":"INR 10000"}});
export const getProductConfig = (productId: string): GooglePlayProductConfig | null => {
  if (!productId) return null;
  return Object.prototype.hasOwnProperty.call(GOOGLE_PLAY_PRODUCTS, productId) ? GOOGLE_PLAY_PRODUCTS[productId] : null;
};
