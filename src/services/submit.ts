import axios, { AxiosInstance } from "axios";
import http from "http";
import https from "https";
import { CategoryIds, TransformedProduct } from "../types";

const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 20,
    timeout: 25000,
    keepAliveMsecs: 60000
});

const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 20,
    timeout: 25000,
    keepAliveMsecs: 60000
});

const axiosInstance: AxiosInstance = axios.create({
    timeout: 25000,
    maxRedirects: 3,
    httpAgent,
    httpsAgent,
    validateStatus: (status) => status < 500
});

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
            if (!error.config.__retryCount) {
                error.config.__retryCount = 0;
            }
            if (error.config.__retryCount < 2) {
                error.config.__retryCount++;
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * error.config.__retryCount)
                );
                return axiosInstance.request(error.config);
            }
        }
        return Promise.reject(error);
    }
);

export async function submitProduct(
    token: string,
    productData: TransformedProduct,
    categoryIds: CategoryIds,
    productAttributeValueId: number | string,
    apiUrl: string
): Promise<number> {
    try {
        const payload = {
            productDTO: {
                name: productData.name,
                nameThai: "",
                nameBurmese: "",
                brand: productData.brand || "",
                description:
                    productData.description === "" ? productData.name : productData.description,
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
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.data?.productDTO?.id) {
            throw new Error("Invalid response: missing product ID");
        }

        return response.data.productDTO.id;
    } catch (error: any) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            let message = "Unknown product submission error";

            if (typeof data === "string") {
                message = data;
            } else if (data) {
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
        } else if (error.request) {
            throw new Error(`No response from server: ${error.message || "Network error"}`);
        } else if (error.message) {
            throw new Error(`Request setup failed: ${error.message}`);
        } else {
            throw new Error(`Unknown product submission error: ${JSON.stringify(error)}`);
        }
    }
}

export async function uploadProductImages(
    token: string,
    productId: number | string,
    imageUrls: string[],
    apiUrl: string
): Promise<{
    uploaded: number;
    failed: number;
    errors: Array<{ imageUrl: string; error: string; statusCode?: number; response?: any }>;
}> {
    const maxImages = 8;
    const imagesToUpload = imageUrls.slice(0, maxImages);
    const concurrency = 8;
    const errors: Array<{ imageUrl: string; error: string; statusCode?: number; response?: any }> =
        [];
    let uploadedCount = 0;

    try {
        for (let i = 0; i < imagesToUpload.length; i += concurrency) {
            const batch = imagesToUpload.slice(i, i + concurrency);

            const results = await Promise.allSettled(
                batch.map(async (imageUrl) => {
                    if (!imageUrl || typeof imageUrl !== "string") {
                        throw new Error("Invalid image URL");
                    }

                    try {
                        const response = await axiosInstance.post(
                            `${apiUrl}/product-image/save-image-url`,
                            { productId, imageUrl },
                            {
                                headers: {
                                    Authorization: `Bearer ${token}`,
                                    "Content-Type": "application/json"
                                },
                                timeout: 25000
                            }
                        );
                        return { success: true, imageUrl };
                    } catch (error: any) {
                        const errorData = {
                            message:
                                error.response?.data?.message ||
                                error.response?.data?.error ||
                                error.message ||
                                "Failed to upload image",
                            statusCode: error.response?.status,
                            response: error.response?.data
                        };
                        throw errorData;
                    }
                })
            );

            results.forEach((result, idx) => {
                if (result.status === "fulfilled") {
                    uploadedCount++;
                } else {
                    const errorData = result.reason;
                    errors.push({
                        imageUrl: batch[idx],
                        error: errorData?.message || "Unknown error occurred",
                        statusCode: errorData?.statusCode,
                        response: errorData?.response
                    });
                }
            });
        }
    } catch (error: any) {
        const processedCount = uploadedCount + errors.length;
        for (let i = processedCount; i < imagesToUpload.length; i++) {
            errors.push({
                imageUrl: imagesToUpload[i],
                error: "Upload process interrupted"
            });
        }
    }

    return {
        uploaded: uploadedCount,
        failed: errors.length,
        errors
    };
}
