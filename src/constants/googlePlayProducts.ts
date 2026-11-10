/**
 * Centralized Google Play Product Catalog for Yaro (Server-side)
 *
 * Immutable mapping of product ID to coin/diamond entitlement and official INR price.
 * Server must ALWAYS derive coin quantity from this catalog and never trust
 * client-supplied price or coin amounts.
 */

export interface GooglePlayProductConfig {
  productId: string;
  diamonds: number;
  coins: number;
  priceInr: number;
  formattedPrice: string;
}

export const GOOGLE_PLAY_PRODUCTS: Record<string, GooglePlayProductConfig> = {
  // --- 10 Online Recharge Plans (Rate: ₹100 = 7,200 Coins, ₹1 = 72 Coins) ---
  coins_720: { productId: 'coins_720', diamonds: 720, coins: 720, priceInr: 10, formattedPrice: '₹10' },
  coins_3600: { productId: 'coins_3600', diamonds: 3600, coins: 3600, priceInr: 50, formattedPrice: '₹50' },
  coins_7200: { productId: 'coins_7200', diamonds: 7200, coins: 7200, priceInr: 100, formattedPrice: '₹100' },
  coins_14400: { productId: 'coins_14400', diamonds: 14400, coins: 14400, priceInr: 200, formattedPrice: '₹200' },
  coins_36000: { productId: 'coins_36000', diamonds: 36000, coins: 36000, priceInr: 500, formattedPrice: '₹500' },
  coins_72000: { productId: 'coins_72000', diamonds: 72000, coins: 72000, priceInr: 1000, formattedPrice: '₹1,000' },
  coins_144000: { productId: 'coins_144000', diamonds: 144000, coins: 144000, priceInr: 2000, formattedPrice: '₹2,000' },
  coins_360000: { productId: 'coins_360000', diamonds: 360000, coins: 360000, priceInr: 5000, formattedPrice: '₹5,000' },
  coins_720000: { productId: 'coins_720000', diamonds: 720000, coins: 720000, priceInr: 10000, formattedPrice: '₹10,000' },
  coins_1440000: { productId: 'coins_1440000', diamonds: 1440000, coins: 1440000, priceInr: 20000, formattedPrice: '₹20,000' },

  // --- Aliases for SKUs matching legacy naming conventions ---
  diamonds_7: { productId: 'coins_720', diamonds: 720, coins: 720, priceInr: 10, formattedPrice: '₹10' },
  yaro_diamonds_7: { productId: 'coins_720', diamonds: 720, coins: 720, priceInr: 10, formattedPrice: '₹10' },
  plan_1: { productId: 'coins_720', diamonds: 720, coins: 720, priceInr: 10, formattedPrice: '₹10' },

  diamonds_36: { productId: 'coins_3600', diamonds: 3600, coins: 3600, priceInr: 50, formattedPrice: '₹50' },
  diamonds_35: { productId: 'coins_3600', diamonds: 3600, coins: 3600, priceInr: 50, formattedPrice: '₹50' },
  yaro_diamonds_35: { productId: 'coins_3600', diamonds: 3600, coins: 3600, priceInr: 50, formattedPrice: '₹50' },
  plan_2: { productId: 'coins_3600', diamonds: 3600, coins: 3600, priceInr: 50, formattedPrice: '₹50' },

  diamonds_72: { productId: 'coins_7200', diamonds: 7200, coins: 7200, priceInr: 100, formattedPrice: '₹100' },
  diamonds_71: { productId: 'coins_7200', diamonds: 7200, coins: 7200, priceInr: 100, formattedPrice: '₹100' },
  yaro_diamonds_71: { productId: 'coins_7200', diamonds: 7200, coins: 7200, priceInr: 100, formattedPrice: '₹100' },
  plan_3: { productId: 'coins_7200', diamonds: 7200, coins: 7200, priceInr: 100, formattedPrice: '₹100' },

  diamonds_144: { productId: 'coins_14400', diamonds: 14400, coins: 14400, priceInr: 200, formattedPrice: '₹200' },
  diamonds_143: { productId: 'coins_14400', diamonds: 14400, coins: 14400, priceInr: 200, formattedPrice: '₹200' },
  yaro_diamonds_143: { productId: 'coins_14400', diamonds: 14400, coins: 14400, priceInr: 200, formattedPrice: '₹200' },
  plan_4: { productId: 'coins_14400', diamonds: 14400, coins: 14400, priceInr: 200, formattedPrice: '₹200' },

  diamonds_360: { productId: 'coins_36000', diamonds: 36000, coins: 36000, priceInr: 500, formattedPrice: '₹500' },
  diamonds_359: { productId: 'coins_36000', diamonds: 36000, coins: 36000, priceInr: 500, formattedPrice: '₹500' },
  yaro_diamonds_359: { productId: 'coins_36000', diamonds: 36000, coins: 36000, priceInr: 500, formattedPrice: '₹500' },
  plan_5: { productId: 'coins_36000', diamonds: 36000, coins: 36000, priceInr: 500, formattedPrice: '₹500' },
  plan_6: { productId: 'coins_36000', diamonds: 36000, coins: 36000, priceInr: 500, formattedPrice: '₹500' },

  diamonds_720: { productId: 'coins_72000', diamonds: 72000, coins: 72000, priceInr: 1000, formattedPrice: '₹1,000' },
  diamonds_719: { productId: 'coins_72000', diamonds: 72000, coins: 72000, priceInr: 1000, formattedPrice: '₹1,000' },
  yaro_diamonds_719: { productId: 'coins_72000', diamonds: 72000, coins: 72000, priceInr: 1000, formattedPrice: '₹1,000' },
  plan_7: { productId: 'coins_72000', diamonds: 72000, coins: 72000, priceInr: 1000, formattedPrice: '₹1,000' },

  diamonds_1440: { productId: 'coins_144000', diamonds: 144000, coins: 144000, priceInr: 2000, formattedPrice: '₹2,000' },
  diamonds_1439: { productId: 'coins_144000', diamonds: 144000, coins: 144000, priceInr: 2000, formattedPrice: '₹2,000' },
  yaro_diamonds_1439: { productId: 'coins_144000', diamonds: 144000, coins: 144000, priceInr: 2000, formattedPrice: '₹2,000' },
  plan_8: { productId: 'coins_144000', diamonds: 144000, coins: 144000, priceInr: 2000, formattedPrice: '₹2,000' },

  diamonds_3600: { productId: 'coins_360000', diamonds: 360000, coins: 360000, priceInr: 5000, formattedPrice: '₹5,000' },
  diamonds_3599: { productId: 'coins_360000', diamonds: 360000, coins: 360000, priceInr: 5000, formattedPrice: '₹5,000' },
  yaro_diamonds_3599: { productId: 'coins_360000', diamonds: 360000, coins: 360000, priceInr: 5000, formattedPrice: '₹5,000' },
  plan_9: { productId: 'coins_360000', diamonds: 360000, coins: 360000, priceInr: 5000, formattedPrice: '₹5,000' },

  diamonds_7200: { productId: 'coins_720000', diamonds: 720000, coins: 720000, priceInr: 10000, formattedPrice: '₹10,000' },
  plan_10: { productId: 'coins_720000', diamonds: 720000, coins: 720000, priceInr: 10000, formattedPrice: '₹10,000' },

  diamonds_14400: { productId: 'coins_1440000', diamonds: 1440000, coins: 1440000, priceInr: 20000, formattedPrice: '₹20,000' },
  plan_11: { productId: 'coins_1440000', diamonds: 1440000, coins: 1440000, priceInr: 20000, formattedPrice: '₹20,000' },

  // --- Legacy SKU fallbacks (ensure past transactions verify correctly) ---
  diamonds_800: { productId: 'diamonds_800', diamonds: 800, coins: 800, priceInr: 59, formattedPrice: '₹59' },
  diamonds_1350: { productId: 'diamonds_1350', diamonds: 1350, coins: 1350, priceInr: 99, formattedPrice: '₹99' },
  diamonds_2700: { productId: 'diamonds_2700', diamonds: 2700, coins: 2700, priceInr: 199, formattedPrice: '₹199' },
  diamonds_5400: { productId: 'diamonds_5400', diamonds: 5400, coins: 5400, priceInr: 399, formattedPrice: '₹399' },
  diamonds_8100: { productId: 'diamonds_8100', diamonds: 8100, coins: 8100, priceInr: 599, formattedPrice: '₹599' },
  diamonds_13500: { productId: 'diamonds_13500', diamonds: 13500, coins: 13500, priceInr: 999, formattedPrice: '₹999' },
  diamonds_27000: { productId: 'diamonds_27000', diamonds: 27000, coins: 27000, priceInr: 1999, formattedPrice: '₹1,999' },
  diamonds_67500: { productId: 'diamonds_67500', diamonds: 67500, coins: 67500, priceInr: 4999, formattedPrice: '₹4,999' },
  diamonds_135000: { productId: 'diamonds_135000', diamonds: 135000, coins: 135000, priceInr: 9999, formattedPrice: '₹9,999' },
};

// 10 Official Public Online Products
export const GOOGLE_PLAY_PRODUCT_IDS = [
  'coins_720',
  'coins_3600',
  'coins_7200',
  'coins_14400',
  'coins_36000',
  'coins_72000',
  'coins_144000',
  'coins_360000',
  'coins_720000',
  'coins_1440000',
];

export const getProductConfig = (productId: string): GooglePlayProductConfig | null => {
  if (!productId) return null;
  return Object.prototype.hasOwnProperty.call(GOOGLE_PLAY_PRODUCTS, productId) ? GOOGLE_PLAY_PRODUCTS[productId] : null;
};
