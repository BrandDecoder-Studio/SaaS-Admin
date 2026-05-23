/**
 * synthesis-engine.js
 * 筋肉層：視覺合成引擎 (SaaS 超模霸權版 + 0.5K 極速降本 + 官方 PNG 浮水印)
 * 🌟 [Update] 支援全域 ai-config.js 模型版本集中控管
 * 🌟 [Update] 正確攔截 builder_settings.remove_watermark 尊榮去浮水印開關
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const sharp = require("sharp");

// 🌟 引入全域 AI 模型設定檔
const { MODEL_IMAGE } = require('./ai-config');

// 🌟 全平台通用官方 PNG 浮水印貼圖
async function applyStandardWatermark(originalBase64) {
    console.log(`🛡️ [浮水印系統] 開始下載官方浮水印 PNG，並執行極速 512px 壓縮...`);
    try {
        const originalBuffer = Buffer.from(originalBase64, 'base64');
        
        // 1. 物理性降維：強制將 AI 吐出的圖縮放為 512x512
        const resizedBuffer = await sharp(originalBuffer)
            .resize(512, 512, { fit: 'cover' })
            .toBuffer();

        // 2. 下載官方 PNG 浮水印
        const watermarkUrl = 'https://branddecoderai.com/Saaswatermarker.png'; 
        const watermarkRes = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        let watermarkBuffer = Buffer.from(watermarkRes.data, 'binary');

        // 3. 強制縮放浮水印寬度，使其與新圖片寬度 (512) 100% 貼合
        watermarkBuffer = await sharp(watermarkBuffer)
            .resize({ width: 512 }) 
            .toBuffer();

        const wmMetadata = await sharp(watermarkBuffer).metadata();
        const wmHeight = wmMetadata.height || 50; 

        // 4. 執行極速貼圖合成 (重力貼底)
        const watermarkedBuffer = await sharp(resizedBuffer)
            .composite([{
                input: watermarkBuffer,
                top: 512 - wmHeight, // 永遠緊貼最底部
                left: 0
            }])
            .jpeg({ quality: 90 }) 
            .toBuffer();

        console.log(`🛡️ [浮水印系統] 壓印與壓縮完成 (最終尺寸: 512x512)。`);
        return watermarkedBuffer.toString('base64');

    } catch (err) {
        console.error("💥 [浮水印系統] 處理失敗，回傳無浮水印圖:", err.message);
        return originalBase64; 
    }
}

// 🌟 核心合成引擎
async function generateShowroomImage(apiKey, contextImagePart, productImageUrl, dynamicPrompt, clientData, productName) {
    try {
        // 🚀 使用全域配置的圖片模型
        console.log(`🎨 [Synthesis Engine] 啟動超模霸權鐵律引擎... (Model: ${MODEL_IMAGE})`);
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: MODEL_IMAGE });

        console.log(`🎨 [Synthesis Engine] 準備下載商品圖: ${productImageUrl}`);

        // 加入 User-Agent 突破防盜鏈
        const productRes = await axios.get(productImageUrl, { 
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Referer': 'https://www.google.com/' 
            }
        });

        const productBase64 = Buffer.from(productRes.data, 'binary').toString('base64');
        const productMime = productRes.headers['content-type'] || 'image/jpeg';
        const productImagePart = { inlineData: { data: productBase64, mimeType: productMime } };

        console.log("🎨 [Synthesis Engine] 商品圖下載成功，準備掛載超模咒語...");

        // ==========================================================
        // 🧠 三軌霸權 Meta Prompt (超模展演 + 絕對保真 + 反突變結界)
        // ==========================================================
        const metaPrompt = `
[SYSTEM ROLE: Master Commercial Compositor & AI Gatekeeper]
TASK: Generate a high-end commercial image integrating the Product (Image 2) EXACTLY according to the AI Director's instruction. If a Target Context (Image 1) is provided, integrate the product into it seamlessly.

[🚨 CRITICAL QUALITY & ANATOMY CONSTRAINTS - FAIL-SAFE]:
1. 🚫 STRICT ANATOMY (NO MUTATIONS): The human model MUST HAVE EXACTLY two arms, two hands, and five fingers per hand. NO extra limbs! NO three hands! NO backwards thumbs or broken joints. Articulation MUST perfectly obey human biomechanics.
2. 🚫 LOGICAL PHYSICS (NO CLIPPING): The way the model holds or interacts with the product must make physical sense. Fingers must NOT merge into or pierce through the product. Accessories (watches, rings) must be structurally perfect or completely omitted.
3. 🚫 NO ALIEN TEXT / GIBBERISH: Do NOT hallucinate, invent, or generate random text/characters/runes anywhere in the image. Keep surfaces clean unless preserving the exact text from Image 2.

[ABSOLUTE HEGEMONY RULES - NON-NEGOTIABLE]:

👑 TRACK 1: VTO & HUMAN SUBJECTS (Product Hegemony & Supermodel Protocol)
If the instructions involve a person wearing/holding the product:
1. 💃 PROFESSIONAL SUPERMODEL PROTOCOL: Treat the human subject as a Top-Tier Commercial Fashion Model whose SOLE PURPOSE is to showcase the product.
2. 🛑 ZERO OCCLUSION RULE: NO hair, NO hands, NO arms, and NO torso can block the product. The product MUST be 100% fully visible to the camera.
3. 🔄 FORCED ROTATION & POSING: If the product is a backpack or worn on the side/back, YOU MUST rotate the human model's torso so the product directly faces the camera.
4. 💎 100% PRODUCT FIDELITY: Maintain the EXACT physical structure, fabric/leather texture, patterns, and logos of the product (Image 2). Do not distort or flatten the product.
5. 👤 STRICT IDENTITY LOCK: The user's face, facial features, hair style, and overall body type (Image 1) MUST BE 100% PRESERVED. Do NOT alter their facial identity.

📸 TRACK 2: PURE STUDIO (White Background)
If the instructions call for a "pure white studio" or "clean background":
- OBLITERATE any background environment. Use a 100% pure clean white seamless backdrop.

🏖️ TRACK 3: SCENE GENERATION (Contextual Background)
If the instructions call for a specific scene WITHOUT mentioning a pure white background:
- Generate the requested highly realistic background environment. 

[CRITICAL INSTRUCTION FROM AI DIRECTOR]:
${dynamicPrompt}
`;

        // 🌟 關鍵防呆：過濾掉 null 的 contextImagePart (情境直出模式不傳底圖)
        const partsToSend = [
            { text: metaPrompt },
            contextImagePart,
            productImagePart
        ].filter(Boolean);

        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: partsToSend
            }],
            generationConfig: {
                responseModalities: ["IMAGE"], 
                imageConfig: {
                    aspectRatio: "1:1",
                    imageSize: "512" // 👈 遵照官方指示，只寫 512，不加 K！
                }
            }
        });

        const generatedPart = result.response.candidates[0].content.parts.find(p => p.inlineData);
        if (!generatedPart) throw new Error("AI 未回傳有效圖片資料");
        
        // 🌟 抓取 Token 用量以利計費
        const tokensUsed = result.response.usageMetadata ? result.response.usageMetadata.totalTokenCount : 0;
        console.log(`🎨 [Synthesis Engine] AI 合成完畢！(消耗 Tokens: ${tokensUsed})`);
        
        // ==========================================================
        // 🌟 浮水印權限判定與官方 PNG 壓印 & 512px 壓縮
        // ==========================================================
        let finalBase64 = generatedPart.inlineData.data;
        let isWatermarkRequired = true; 

        // 💡 [修正] 1. 檢查 SaaS 後台開關 (付費去浮水印模式)
        if (clientData && clientData.builder_settings && clientData.builder_settings.remove_watermark === true) {
            isWatermarkRequired = false;
            console.log(`🛡️ [浮水印系統] 偵測到「尊榮去浮水印」開關已開啟，準備輸出純淨原圖 (+5% 算力費)。`);
        }

        // 💡 2. 檢查舊版的限時豁免權
        if (isWatermarkRequired && clientData && clientData.watermark_free_until) {
            try {
                const expireTime = typeof clientData.watermark_free_until.toDate === 'function' 
                    ? clientData.watermark_free_until.toDate().getTime() 
                    : new Date(clientData.watermark_free_until).getTime();
                
                if (Date.now() < expireTime) {
                    isWatermarkRequired = false;
                    console.log(`🛡️ [浮水印系統] 豁免期內，輸出純淨原圖。`);
                }
            } catch (e) {
                console.warn("⚠️ [浮水印系統] 時間解析異常，預設強制壓印！", e);
            }
        }

        // 💡 如果還是需要浮水印，就壓上去；不需要的話，依然執行 512x512 壓縮以提升載入速度
        if (isWatermarkRequired) {
            console.log(`🛡️ [浮水印系統] 執行強制壓印與降維。`);
            finalBase64 = await applyStandardWatermark(finalBase64);
        } else {
            console.log(`🛡️ [浮水印系統] 尊榮模式：免壓印，僅執行 512px 壓縮以加速傳輸。`);
            const resizedBuffer = await sharp(Buffer.from(finalBase64, 'base64'))
                .resize(512, 512, { fit: 'cover' })
                .jpeg({ quality: 90 })
                .toBuffer();
            finalBase64 = resizedBuffer.toString('base64');
        }

        return {
            status: "success",
            base64: finalBase64,
            tokens: tokensUsed // 🌟 將 Token 回傳給 Worker，解決計費為 0 的問題
        };

    } catch (error) {
        console.error(`💥 [Synthesis Engine] 錯誤:`, error.message);
        if (error.response && error.response.status === 403) {
             console.error("💥 防盜鏈保護觸發，請建議客戶將圖片傳至自己的 Firebase Storage。");
        }
        return {
            status: "error",
            message: error.message
        };
    }
}

module.exports = { generateShowroomImage };