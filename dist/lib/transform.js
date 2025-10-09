"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformProductData = transformProductData;
const parsers_1 = require("./parsers");
function transformProductData(details) {
    const dimensions = (0, parsers_1.extractDimensions)(details.specifications["Total volume"]);
    const pricePerUnit = (0, parsers_1.extractPrice)(details.pricePerUnit);
    const originalPrice = (0, parsers_1.getOriginalPrice)(pricePerUnit, details.discountPercent || 0);
    return {
        name: (0, parsers_1.cleanProductName)(details.title),
        brand: details.brand || null,
        url: details.url,
        images: details.images || [],
        variant: {
            image: details.images?.[0] || null,
            price: originalPrice,
            sku: details.code || details.specifications["SKU"] || null,
            discount: details.discountPercent || 0,
            length: dimensions.length,
            width: dimensions.width,
            height: dimensions.height,
            weight: dimensions.weight
        }
    };
}
