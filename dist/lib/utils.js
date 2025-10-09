"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = delay;
exports.cleanUpUrl = cleanUpUrl;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function cleanUpUrl(url) {
    const urlObj = new URL(url);
    urlObj.search = "";
    return urlObj.toString();
}
