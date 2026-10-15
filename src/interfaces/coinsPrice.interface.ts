export interface IPricePlan {
  title?: string;
  description: string;
  actualPrice: number;
  discountedPrice?: number;
  coins: number;
  diamonds?: number;
  bonusCoins?: number;
  badge?: string;
  productId?: string;
  type: "offline" | "online" | "google_play" | "special";
  icon?: string;
  isActive?: boolean;
  sortOrder?: number;
  currency?: string;
}