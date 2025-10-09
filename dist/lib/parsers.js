"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDimensions = extractDimensions;
exports.extractPrice = extractPrice;
exports.getOriginalPrice = getOriginalPrice;
exports.cleanProductName = cleanProductName;
function extractDimensions(volumeText) {
    const dimensions = { length: null, width: null, height: null, weight: null };
    if (!volumeText)
        return dimensions;
    const match = volumeText.match(/([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)\s*cm.*?([\d.]+)\s*kg/i);
    if (match) {
        dimensions.length = parseFloat(match[1]);
        dimensions.width = parseFloat(match[2]);
        dimensions.height = parseFloat(match[3]);
        dimensions.weight = parseFloat(match[4]);
    }
    return dimensions;
}
function extractPrice(priceText) {
    if (!priceText)
        return null;
    const match = priceText.match(/([\d,]+(?:\.[\d]+)?)/);
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}
function getOriginalPrice(discountedPrice, discountPercent) {
    if (discountedPrice == null)
        return null;
    const discountRate = 1 - (discountPercent || 0) / 100;
    const originalPrice = discountedPrice / discountRate;
    return parseFloat(originalPrice.toFixed(2));
}
function cleanProductName(name) {
    return name ? name.replace(/\s*x\s*\d+\s*$/i, "").trim() : name;
}
