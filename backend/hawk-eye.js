/**
 * 🦅 Hawk-Eye Vision Module (hawk-eye.js)
 * Version: v1.6 (SaaS Pro 備援與精準計費版)
 * --------------------------------------------------------------------
 * [Update] v1.6:
 * 1. 🛡️ 實裝 ai-config 全域模型控管與 Primary/Fallback 雙保險備援切換。
 * 2. 💰 提取多模態 (Vision) 算力消耗 Token，回傳供主引擎計費。
 * 3. 🛠️ 強化 JSON 解析容錯機制，確保系統不崩潰。
 */

const axios = require('axios');
// 🌟 引入全域 AI 模型設定檔
const { MODEL_PRIMARY, MODEL_FALLBACK } = require('./ai-config');

async function analyzeImage(messageId, channelAccessToken, genAI, overrideModel = null) {
    // 1. 從 LINE 下載圖片
    console.log(`🦅 [Hawk-Eye] 開始下載 LINE 圖片 (MessageID: ${messageId})...`);
    const lineImageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
        headers: { 'Authorization': `Bearer ${channelAccessToken}` },
        responseType: 'arraybuffer'
    });
    const base64Data = Buffer.from(lineImageRes.data, 'binary').toString('base64');
    const imagePart = { inlineData: { data: base64Data, mimeType: "image/jpeg" } };

    const prompt = `
    [SYSTEM ROLE: High-End Retail AI Vision Agent]
    Analyze the image and categorize the user's intent to route them to the correct SaaS service.

    RULES:
    1. "CONTEXT_SCENE" (情境底圖): Image contains a person (selfie/portrait) OR a physical space (living room/desk). The user provides a canvas for "Immersive Showroom" (Virtual Try-on / Scene Setup).
    2. "PRODUCT_SKU" (商品找款): Image focuses strictly on a product (jewelry, clothes, furniture). The user wants to search for it.
    3. "OTHER" (其他防呆): Irrelevant images like food, pets, memes, or screenshots of pure text.

    OUTPUT SCHEMA (Strict JSON):
    {
      "intent": "CONTEXT_SCENE" | "PRODUCT_SKU" | "OTHER",
      "style": "string (e.g., 簡約優雅, 街頭潮流. If none, output N/A)",
      "features": "string (e.g., V領上衣, 木質桌面, 短髮. If none, output N/A)",
      "vibe": "string (e.g., 暖色調咖啡廳, 明亮戶外. If none, output N/A)",
      "search_keywords": "string (Extract product keywords ONLY if intent is PRODUCT_SKU, else empty)"
    }
    `;

    // 優先使用傳入的 overrideModel，否則使用全域主力模型
    const primaryModelToUse = overrideModel || MODEL_PRIMARY;
    let finalModelUsed = primaryModelToUse;
    let responseText = "";
    let tokensUsed = 0;

    try {
        // 🚀 [首選路徑] 嘗試使用 Primary 模型
        console.log(`🦅 [Hawk-Eye] 喚醒視覺大腦 (Model: ${primaryModelToUse})...`);
        const model = genAI.getGenerativeModel({ 
            model: primaryModelToUse,
            generationConfig: { responseMimeType: "application/json" } 
        });
        
        const result = await model.generateContent([prompt, imagePart]);
        responseText = result.response.text();
        tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;

    } catch (errorPrimary) {
        console.warn(`[Hawk-Eye Warning] ⚠️ Primary 模型 (${primaryModelToUse}) 視覺解析異常，自動切換至備援模型...`);
        
        try {
            // 🛡️ [備援路徑] 啟動 Fallback 模型
            finalModelUsed = MODEL_FALLBACK;
            const fallbackModel = genAI.getGenerativeModel({ 
                model: MODEL_FALLBACK,
                generationConfig: { responseMimeType: "application/json" } 
            });
            
            const result = await fallbackModel.generateContent([prompt, imagePart]);
            responseText = result.response.text();
            tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;

        } catch (errorFallback) {
            console.error(`[Hawk-Eye Error] ❌ 雙模型皆失效！錯誤: ${errorFallback.message}`);
            // 🚨 最壞情況：回傳防呆預設值，讓系統繼續走一般聊天流程
            return {
                intent: "OTHER", style: "N/A", features: "N/A", vibe: "N/A", search_keywords: "",
                tokens: 0, modelUsed: "ERROR"
            };
        }
    }

    // 3. 解析與封裝回傳值
    try {
        const jsonResponse = JSON.parse(responseText);
        // 💰 將 Token 消耗與使用的模型打包塞進去，讓主引擎可以扣款
        jsonResponse.tokens = tokensUsed;
        jsonResponse.modelUsed = finalModelUsed;
        
        console.log(`🦅 [Hawk-Eye] 解析完成！意圖: ${jsonResponse.intent} | 消耗 Token: ${tokensUsed}`);
        return jsonResponse;

    } catch (parseError) {
        console.error(`[Hawk-Eye Error] JSON 解析失敗，原始輸出: ${responseText}`);
        return {
            intent: "OTHER", style: "N/A", features: "N/A", vibe: "N/A", search_keywords: "",
            tokens: tokensUsed, modelUsed: finalModelUsed
        };
    }
}

module.exports = { analyzeImage };