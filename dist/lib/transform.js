"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformProductData = transformProductData;
const parsers_1 = require("./parsers");
function transformProductData(details) {
    const dimensions = (0, parsers_1.extractDimensions)(details.specifications["Total volume"]);
    const sku = (0, parsers_1.getPrefixedSku)(details);
    // const pricePerUnit = extractPricePerUnit(details.pricePerUnit);
    return {
        name: details.title,
        brand: details.brand || null,
        url: details.url,
        images: details.images || [],
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
