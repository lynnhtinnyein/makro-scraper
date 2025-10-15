export interface Dimensions {
    length: number | null;
    width: number | null;
    height: number | null;
    weight: number | null;
}

export interface ProductVariant {
    image: string | null;
    price: number | null;
    sku: string | null;
    discount: number;
    length: number | null;
    width: number | null;
    height: number | null;
    weight: number | null;
}

export interface TransformedProduct {
    name: string | null | undefined;
    description: string | null | undefined;
    brand: string | null;
    url: string;
    images: string[];
    variant: ProductVariant;
}

export interface ProductDetailRaw {
    title: string;
    brand: string;
    description: string;
    pricePerUnit: string;
    originalPrice: number;
    discountedPrice: number;
    code: string;
    discountPercent: number;
    specifications: Record<string, string>;
    images: string[];
    url: string;
}

export interface CategoryIds {
    mainCategoryId: number;
    subCategoryId: number;
    categoryId: number;
    sellerId: number;
}

export interface SubmitResponseSummary {
    addedCount: number;
    errors?: Array<{ url: string; error: string }>;
}
