"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitProduct = submitProduct;
exports.uploadProductImages = uploadProductImages;
const axios_1 = __importDefault(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const axiosInstance = axios_1.default.create({
    timeout: 30000,
    maxRedirects: 5,
    httpAgent: new http_1.default.Agent({ keepAlive: true }),
    httpsAgent: new https_1.default.Agent({ keepAlive: true })
});
async function submitProduct(token, productData, categoryIds, productAttributeValueId, apiUrl) {
    try {
        const payload = {
            productDTO: {
                name: productData.name,
                nameThai: "",
                nameBurmese: "",
                brand: productData.brand || "",
                description: productData.name,
                descriptionThai: "",
                descriptionBurmese: "",
                categoryId: categoryIds.categoryId,
                productLicenseType: "NONE",
                productLicenseNumber: "",
                mainCategoryId: categoryIds.mainCategoryId,
                subCategoryId: categoryIds.subCategoryId,
                subSubCategoryId: categoryIds.categoryId,
                sellerId: categoryIds.sellerId,
                price: 0,
                discount: 0,
                stock: 0,
                slug: "product-slug",
                isDiscount: (productData.variant.discount || 0) > 0
            },
            productVariantDTO: [
                {
                    price: String(productData.variant.price || 0),
                    stock: "9999999",
                    sku: productData.variant.sku || "",
                    discount: String(productData.variant.discount || 0),
                    weight: String(productData.variant.weight || 0),
                    width: String(productData.variant.width || 0),
                    length: String(productData.variant.length || 0),
                    height: String(productData.variant.height || 0),
                    enable: true,
                    productAttributeValueId: [String(productAttributeValueId)],
                    imageUrl: productData.variant.image || ""
                }
            ]
        };
        const response = await axiosInstance.post(`${apiUrl}/product/saveWithVariants`, payload, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        });
        if (!response.data?.productDTO?.id) {
            throw new Error("Invalid response: missing product ID");
        }
        return response.data.productDTO.id;
    }
    catch (error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            let message = "Unknown product submission error";
            if (typeof data === "string") {
                message = data;
            }
            else if (data) {
                message =
                    data.message ||
                        data.error ||
                        data.errors?.[0]?.message ||
                        data.errors?.[0] ||
                        data.detail ||
                        data.title ||
                        JSON.stringify(data);
            }
            if (!message || message === "Unknown product submission error") {
                message = error.response.statusText || "Request failed";
            }
            throw new Error(`Product Submit Error (${status}): ${message}`);
        }
        else if (error.request) {
            throw new Error(`No response from server: ${error.message || "Network error"}`);
        }
        else if (error.message) {
            throw new Error(`Request setup failed: ${error.message}`);
        }
        else {
            throw new Error(`Unknown product submission error: ${JSON.stringify(error)}`);
        }
    }
}
async function uploadProductImages(token, productId, imageUrls, apiUrl) {
    const maxImages = 8;
    const imagesToUpload = imageUrls.slice(0, maxImages);
    const concurrency = 3;
    const errors = [];
    for (let i = 0; i < imagesToUpload.length; i += concurrency) {
        const batch = imagesToUpload.slice(i, i + concurrency);
        const promises = batch.map((imageUrl) => axiosInstance
            .post(`${apiUrl}/product-image/save-image-url`, { productId, imageUrl }, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        })
            .catch((error) => {
            errors.push({ imageUrl, error: error.message });
            return null;
        }));
        await Promise.all(promises);
    }
    return { uploaded: imagesToUpload.length - errors.length, errors };
}
