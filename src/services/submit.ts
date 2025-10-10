import axios from "axios";
import http from "http";
import https from "https";
import { CategoryIds, TransformedProduct } from "../types";

const axiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 5,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true })
});

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

            throw new Error(`Product Submit Error (${status}): ${message} : to ${apiUrl}`);
        } else if (error.request) {
            throw new Error(
                `No response from server: ${error.message || "Network error"} : to ${apiUrl}`
            );
        } else if (error.message) {
            throw new Error(`Request setup failed: ${error.message} : to ${apiUrl}`);
        } else {
            throw new Error(
                `Unknown product submission error: ${JSON.stringify(error)} : to ${apiUrl}`
            );
        }
    }
}

export async function uploadProductImages(
    token: string,
    productId: number | string,
    imageUrls: string[],
    apiUrl: string
): Promise<{ uploaded: number; errors: Array<{ imageUrl: string; error: string }> }> {
    const maxImages = 8;
    const imagesToUpload = imageUrls.slice(0, maxImages);
    const concurrency = 3;
    const errors: Array<{ imageUrl: string; error: string }> = [];
    for (let i = 0; i < imagesToUpload.length; i += concurrency) {
        const batch = imagesToUpload.slice(i, i + concurrency);
        const promises = batch.map((imageUrl) =>
            axiosInstance
                .post(
                    `${apiUrl}/product-image/save-image-url`,
                    { productId, imageUrl },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json"
                        }
                    }
                )
                .catch((error) => {
                    errors.push({ imageUrl, error: error.message });
                    return null;
                })
        );
        await Promise.all(promises);
    }
    return { uploaded: imagesToUpload.length - errors.length, errors };
}
