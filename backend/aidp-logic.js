/**
 * ============================================================================
 * 🧠 aidp-logic.js (SaaS 2.1 鋼印驅動 & 全域備援版)
 * 核心功能：雙層大腦推演系統 (支援 ai-config 全域控管與雙模型無縫切換備援)
 * ============================================================================
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// 🌟 引入全域 AI 模型設定檔
const { MODEL_PRIMARY, MODEL_FALLBACK } = require('./ai-config');

/**
 * 大腦一：商品情境分析 (AI 鋼印優先 + 動態規則組裝)
 */
async function analyzeProduct(apiKey, modelName, productName, strategy = 'basic', aiAuditData = null) {
    // 優先使用傳入的模型，若無則使用全域主力模型
    const primaryModelToUse = modelName || MODEL_PRIMARY;
    console.log(`🧠 [分析大腦] 啟動分析: ${productName} (Model: ${primaryModelToUse})`);

    const lockedTags = (aiAuditData && aiAuditData.ai_tags && aiAuditData.ai_tags.length > 0) 
        ? aiAuditData.ai_tags.join(", ") 
        : "基礎商品";
        
    const route = (aiAuditData && aiAuditData.system_route) ? aiAuditData.system_route : "VTO_PERSON";

    // ==================================================================
    // 🛡️ [0 Token 結帳區]：完全依賴 SaaS 海關的 5 大鋼印
    // ==================================================================
    if (route) {
        console.log(`🛡️ [AI 海關] 偵測到鋼印路由: [${route}]，直接套用標籤: ${lockedTags}`);
        
        let mockResult = {
            category: "已驗證商品",
            is_sensitive: (route === 'SCENE_GEN'),
            interaction_type: route,
            top_scenarios: []
        };

        if (route === 'SCENE_GEN') {
            mockResult.top_scenarios = [
                {
                    label: "✨ 去背純淨展示",
                    intent: `High-end 3D opaque white plastic mannequin wearing the product. 100% pure white studio background. No human skin. Critical features: [${lockedTags}].`,
                    photo_hint: "✨ 此模式為保護隱私與呈現高質感，免傳照片直接為您生成專屬美圖喔！"
                },
                {
                    label: "🏖️ 情境氛圍展示",
                    intent: `High-end 3D opaque white plastic mannequin wearing the product. Naturally placed in a beautiful context. No human skin. Critical features: [${lockedTags}].`,
                    photo_hint: "✨ 此模式為保護隱私與呈現高質感，免傳照片直接為您生成專屬美圖喔！"
                }
            ];
        } else if (route === 'VTO_PERSON') {
            mockResult.top_scenarios = [
                {
                    label: "👑 經典全貌展示",
                    intent: `[PRODUCT SUPREMACY] The model acts as a display mannequin in a clean lifestyle environment. Ensure 100% visibility of: [${lockedTags}]. Do not hide the product.`,
                    photo_hint: "✨ 為了呈現最佳效果，請為我上傳一張有您的臉或上半身的照片喔！"
                },
                {
                    label: "⚡ 機能情境展示",
                    intent: `[PRODUCT SUPREMACY] The model is interacting with the product in a dynamic environment. Highlight functionality: [${lockedTags}].`,
                    photo_hint: "✨ 為了呈現最佳效果，請為我上傳一張有您的臉或上半身的照片喔！"
                }
            ];
        } else if (route === 'VTO_SPACE') {
            mockResult.top_scenarios = [
                {
                    label: "🛋️ 空間擺放",
                    intent: `The product must be realistically placed in the provided space. Accurate scale and lighting. Critical features: [${lockedTags}].`,
                    photo_hint: "✨ 想看看擺在家裡的感覺嗎？請為我上傳一張空間照片喔！"
                }
            ];
        } else if (route === 'HYBRID_INTERACTION') {
            mockResult.top_scenarios = [
                {
                    label: "🙋‍♀️ 互動展示",
                    intent: `[PRODUCT SUPREMACY] The user is interacting naturally with the product (e.g., holding, using). Focus on the relationship between the person and the item. Critical features: [${lockedTags}].`,
                    photo_hint: "✨ 想看看您拿著它的樣子嗎？請為我上傳一張您的半身照喔！"
                },
                {
                    label: "📸 實景試擺",
                    intent: `Placement: Naturally resting on the user-provided surface (table, shelf, bed). Vibe: Match the lighting of the user's photo. Ensure correct scale. Critical features: [${lockedTags}]. NO HUMANS.`,
                    photo_hint: "✨ 想看看它擺設的樣子嗎？請為我拍一張您想置放位置的照片、櫃子、床鋪、桌子都可以喔！"
                }
            ];
        } else if (route === 'STATIC') {
            mockResult.top_scenarios = [
                {
                    label: "📸 實景試擺",
                    intent: `Placement: Naturally resting on the user-provided surface. Ensure correct scale. Critical features: [${lockedTags}]. NO HUMANS.`,
                    photo_hint: "✨ 想看看它擺設的樣子嗎？請為我拍一張您想置放位置的照片、櫃子、床鋪、桌子都可以喔！"
                },
                {
                    label: "✨ AI 質感擺拍",
                    intent: `Placement: A highly aesthetic, minimalist studio setting or lifestyle tabletop. Vibe: Soft, cinematic studio lighting. The object is the absolute focal point. Critical features: [${lockedTags}]. NO HUMANS.`,
                    photo_hint: "✨ 沒問題！本模式為保護隱私與呈現最高質感，不需上傳照片。AI 魔法師正在為您直接生成專屬美圖..."
                }
            ];
        }
        return { success: true, data: mockResult, tokens: 0 };
    }

    // ==================================================================
    // 🧠 [大腦推演區]：無路由時 (Fallback) 實裝雙保險備援
    // ==================================================================
    try {
        console.log(`⚠️ [分析大腦] 啟動推演方程式... (依據標籤: ${lockedTags})`);
        const genAI = new GoogleGenerativeAI(apiKey);
        
        let routeSpecificRules = "";
        if (route === "HYBRID_INTERACTION") {
            routeSpecificRules = `
[TRACK: HYBRID_INTERACTION]
- Scenario 1: label "🙋‍♀️ 互動展示", intent "User interacting naturally with product.", photo_hint "✨ 想看看您拿著它的樣子嗎？請為我上傳一張您的半身照喔！"
- Scenario 2: label "📸 實景試擺", intent "Placement on a surface. NO HUMANS.", photo_hint "✨ 想看看它擺設的樣子嗎？請為我拍一張您想置放位置的照片、櫃子、床鋪、桌子都可以喔！"`;
        } else if (route === "STATIC") {
            routeSpecificRules = `
[TRACK: STATIC]
- Scenario 1: label "📸 實景試擺", intent "Placement on a provided surface.", photo_hint "✨ 想看看它擺設的樣子嗎？請拍一張照片喔！"
- Scenario 2: label "✨ AI 質感擺拍", intent "Aesthetic studio setting.", photo_hint "✨ 沒問題！為保護隱私不需上傳照片，直接生成美圖..."`;
        }

        const prompt = `
[SYSTEM ROLE: Master AI Visual Merchandiser]
Analyze the product using ONLY the Product Name and AI-Verified Tags. Ignore any other assumptions.

Product Name: "${productName}"
AI-Verified Tags: "${lockedTags}"
System Route: "${route}"

${routeSpecificRules}

[OUTPUT FORMAT - STRICT COMPLIANCE REQUIRED]
You MUST output ONLY a valid JSON object. NO markdown. You MUST generate EXACTLY 2 items in top_scenarios.
{
  "category": "String (Product type)",
  "is_sensitive": Boolean,
  "interaction_type": "${route}",
  "top_scenarios": [
    {
      "label": "Emoji + 4-6 chars",
      "intent": "MUST BE IN ENGLISH. Detailed prompt.",
      "photo_hint": "MUST output the exact string defined."
    },
    {
      "label": "Emoji + 4-6 chars",
      "intent": "MUST BE IN ENGLISH. Detailed prompt.",
      "photo_hint": "MUST output the exact string defined."
    }
  ]
}
`;

        let result;
        // 🚀 [嘗試 Primary 模型]
        try {
            const model = genAI.getGenerativeModel({ model: primaryModelToUse });
            result = await model.generateContent(prompt);
        } catch (errPrimary) {
            console.warn(`[分析大腦 Warning] ⚠️ Primary 模型 (${primaryModelToUse}) 異常，切換備援模型...`);
            // 🛡️ [切換 Fallback 模型]
            const fallbackModel = genAI.getGenerativeModel({ model: MODEL_FALLBACK });
            result = await fallbackModel.generateContent(prompt);
        }

        let responseText = result.response.text().trim();
        if (responseText.startsWith('```')) {
            responseText = responseText.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '').trim();
        }

        const parsedData = JSON.parse(responseText);
        const tokens = result.response.usageMetadata ? result.response.usageMetadata.totalTokenCount : 0;
        
        console.log(`🧠 [分析大腦] 方程式推演完成: ${parsedData.interaction_type} | 消耗 Token: ${tokens}`);
        return { success: true, data: parsedData, tokens: tokens };

    } catch (error) {
        console.error("💥 [分析大腦 Error]:", error.message);
        return { success: false, error: error.message, tokens: 0 };
    }
}

/**
 * 大腦二：攝影把關 (霸權授權版：強制允許旋轉身體) 實裝雙保險備援
 */
async function validateUserPhoto(apiKey, modelName, targetIntent, base64Image) {
    try {
        const primaryModelToUse = modelName || MODEL_PRIMARY;
        console.log(`📸 [攝影大腦] 啟動寬容度把關... 預期情境: ${targetIntent} (Model: ${primaryModelToUse})`);
        const genAI = new GoogleGenerativeAI(apiKey);
        
        const prompt = `
[SYSTEM ROLE: AI Visual Feature Extractor & Sales Director]
Your goal is to MAXIMIZE successful virtual try-ons. You are NOT a strict photographer. Extract biometric or spatial anchors to execute the Target Intent.

Target Intent: "${targetIntent}"

[EVALUATION RULES - THE "ONLY" RED LINES]
1. FOR HUMAN/ON-BODY INTENTS: 
   - REJECT ONLY IF there is absolutely NO human face and NO human body in the photo.
   - If there is a face or body, PASS IT IMMEDIATELY. Ignore current clothing/pose.
2. FOR SPACE/OBJECT PLACEMENT INTENTS:
   - REJECT ONLY IF the photo has absolutely no environmental context (e.g., a solid black image). 

[IF PASS: CREATE THE "HEGEMONY" DYNAMIC PROMPT]
If PASS, you must create the 'dynamic_prompt'.
- Integrate the Target Intent naturally.
- CRITICAL HEGEMONY RULE FOR HUMANS: "The person's facial identity MUST be 100% preserved. However, the AI is FULLY AUTHORIZED to ZOOM OUT, ROTATE THE TORSO (e.g., turn 3/4 side or back), re-pose the limbs, and change clothing to ensure the Product is 100% FULLY VISIBLE as the hero of the shot."

[OUTPUT FORMAT]
You MUST output ONLY a valid JSON object. NO markdown.
{
  "status": "PASS" or "REJECT",
  "reject_reason": "If REJECT, 1-sentence reason in Traditional Chinese. If PASS, leave empty.",
  "dynamic_prompt": "If PASS, detailed instruction in English. If REJECT, leave empty."
}
`;

        let result;
        // 🚀 [嘗試 Primary 模型]
        try {
            const model = genAI.getGenerativeModel({ model: primaryModelToUse });
            result = await model.generateContent([
                { text: prompt },
                { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
            ]);
        } catch (errPrimary) {
            console.warn(`[攝影大腦 Warning] ⚠️ Primary 模型 (${primaryModelToUse}) 異常，切換備援模型...`);
            // 🛡️ [切換 Fallback 模型]
            const fallbackModel = genAI.getGenerativeModel({ model: MODEL_FALLBACK });
            result = await fallbackModel.generateContent([
                { text: prompt },
                { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
            ]);
        }

        let responseText = result.response.text().trim();
        if (responseText.startsWith('```')) {
            responseText = responseText.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '').trim();
        }

        const parsedData = JSON.parse(responseText);
        const tokens = result.response.usageMetadata ? result.response.usageMetadata.totalTokenCount : 0;

        console.log(`📸 [攝影大腦] 審查結果: ${parsedData.status} | 消耗 Token: ${tokens}`);
        return { success: true, data: parsedData, tokens: tokens };

    } catch (error) {
        console.error("💥 [攝影大腦 Error]:", error.message);
        // 萬一全部爛掉，預設放行 (最大化轉換率)
        return {
            success: true,
            data: { status: 'PASS', dynamic_prompt: targetIntent },
            tokens: 0
        };
    }
}

module.exports = { analyzeProduct, validateUserPhoto };