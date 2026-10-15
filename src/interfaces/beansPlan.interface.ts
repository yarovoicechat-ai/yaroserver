export interface IBeansPlan {
  name: string;
  beans: number;
  diamonds: number;
  bonusDiamonds?: number;
  price?: number;
  currency?: string;
  badge?: string;
  type: 'exchange' | 'purchase' | 'agency';
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}
