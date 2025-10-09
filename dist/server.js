"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiUrl = getApiUrl;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const browser_1 = require("./lib/browser");
const scraper_1 = require("./services/scraper");
const transform_1 = require("./lib/transform");
const submit_1 = require("./services/submit");
const environment = process.env.NODE_ENV || "development";
const envFile = `.env.${environment}`;
dotenv_1.default.config({ path: envFile });
const uatApiUrl = process.env.NEONMALL_UAT_API_URL;
const prodApiUrl = process.env.NEONMALL_PROD_API_URL;
function getApiUrl(origin) {
    if (!uatApiUrl || !prodApiUrl) {
        throw new Error("NEONMALL_UAT_API_URL and NEONMALL_PROD_API_URL must be set in environment variables");
    }
    return origin && origin.includes("admin.neonmall.co") ? prodApiUrl : uatApiUrl;
}
const app = (0, express_1.default)();
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : ["*"];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: ["GET", "POST"]
}));
app.use(express_1.default.json());
app.get("/health", async (_req, res) => {
    res.status(200).json({
        message: "Makro Scraper API is running",
        status: "ok",
        poolSize: (0, browser_1.getPoolSize)(),
        endpoints: { getProductList: "/api/products/list", submitProducts: "/api/products/submit" }
    });
});
app.post("/api/products/list", async (req, res) => {
    const { url, max } = req.body;
    const maxProducts = Math.min(parseInt(String(max)) || 20, 20);
    if (!url)
        return res.status(400).json({ error: "URL parameter is required" });
    try {
        const products = await (0, scraper_1.scrapeProductList)(url, maxProducts);
        res.json(products);
    }
    catch (error) {
        console.error("Product list endpoint error:", error);
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/products/submit", async (req, res) => {
    const { token, productGroups } = req.body;
    if (!token || !productGroups || !Array.isArray(productGroups)) {
        return res.status(400).json({ error: "Token and productGroups are required" });
    }
    const origin = req.get('origin') || req.get('referer');
    const apiUrl = getApiUrl(origin);
    let addedCount = 0;
    const errors = [];
    try {
        for (const group of productGroups) {
            const { productUrls, mainCategoryId, subCategoryId, categoryId, sellerId, productAttributeValueId } = group;
            const concurrency = 2;
            for (let i = 0; i < productUrls.length; i += concurrency) {
                const batch = productUrls.slice(i, i + concurrency);
                const results = await Promise.allSettled(batch.map(async (productUrl) => {
                    const detailRaw = await (0, scraper_1.scrapeProductDetail)(productUrl);
                    const product = (0, transform_1.transformProductData)(detailRaw);
                    const productId = await (0, submit_1.submitProduct)(token, product, { mainCategoryId, subCategoryId, categoryId, sellerId }, productAttributeValueId, apiUrl);
                    if (productId && product.images?.length > 0) {
                        await (0, submit_1.uploadProductImages)(token, productId, product.images, apiUrl);
                    }
                    return { success: true };
                }));
                results.forEach((result, idx) => {
                    if (result.status === "fulfilled" && result.value.success) {
                        addedCount++;
                    }
                    else {
                        errors.push({ url: batch[idx], error: result.reason?.message || "Unknown error" });
                    }
                });
            }
        }
        res.status(200).json({ addedCount, errors: errors.length > 0 ? errors : undefined });
    }
    catch (error) {
        console.error("Submit products error:", error);
        res.status(500).json({ error: error.message, addedCount });
    }
});
app.get("/close", async (_req, res) => {
    try {
        await (0, browser_1.closeAll)();
        res.json({ success: true, message: "Browser closed successfully" });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
const server = http_1.default.createServer(app);
const PORT = process.env.PORT || 4000;
const hostUrl = process.env.HOST_URL || "0.0.0.0";
server.listen(PORT, hostUrl, () => {
    console.log(`========================================`);
    console.log(`Makro Scraper API is running`);
    console.log(`Port: ${PORT}`);
    console.log(`========================================`);
});
process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await (0, browser_1.closeAll)();
    process.exit(0);
});
