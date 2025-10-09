import { extractDimensions, extractPrice, getOriginalPrice, cleanProductName } from "./parsers";
import { ProductDetailRaw, TransformedProduct } from "../types";

export function transformProductData(details: ProductDetailRaw): TransformedProduct {
    const dimensions = extractDimensions(details.specifications["Total volume"]);
    const pricePerUnit = extractPrice(details.pricePerUnit);
    const originalPrice = getOriginalPrice(pricePerUnit, details.discountPercent || 0);
    return {
        name: cleanProductName(details.title),
        brand: details.brand || null,
        url: details.url,
        images: details.images || [],
        variant: {
            image: details.images?.[0] || null,
            price: originalPrice,
            sku: (details as any).code || details.specifications["SKU"] || null,
            discount: details.discountPercent || 0,
            length: dimensions.length,
            width: dimensions.width,
            height: dimensions.height,
            weight: dimensions.weight
        }
    };
}
