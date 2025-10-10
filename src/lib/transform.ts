import { extractDimensions, getPrefixedSku } from "./parsers";
import { ProductDetailRaw, TransformedProduct } from "../types";

export function transformProductData(details: ProductDetailRaw): TransformedProduct {
    const dimensions = extractDimensions(details.specifications["Total volume"]);
    const sku = getPrefixedSku(details);
    // const pricePerUnit = extractPricePerUnit(details.pricePerUnit);

    return {
        name: details.title,
        brand: details.brand || null,
        url: details.url,
        images: details.images || [],
        description: "",
        variant: {
            image: details.images?.[0] || null,
            price: details.originalPrice,
            sku: sku,
            discount: details.discountPercent || 0,
            length: dimensions.length,
            width: dimensions.width,
            height: dimensions.height,
            weight: dimensions.weight
        }
    };
}
