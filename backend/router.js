/**
 * 🚦 Intent Router Module (router.js) - v4.3 Pro SaaS Edition (雙區間預算版)
 * ------------------------------------------------
 * [Update] v4.3:
 * 1. 🎯 雙區間精準解析: 支援 MIN_PRICE 與 MAX_PRICE，完美聽懂「以上」、「以下」、「區間」。
 * 2. 🛡️ 護欄擴充: 加入「以上, 以下, 區間」，確保單純報預算時強制導正為 PRODUCT。
 * [Update] v4.2: 
 * 1. 🌟 四大分流架構: PRODUCT, LOCATION, LEADS, CHAT，精準捕捉商機。
 * 2. ⚡ 短期對話記憶: 引入上一回合對話，完美解析客人使用的「代名詞」。
 * 3. 🛡️ 雙保險備援: 實裝 MODEL_PRIMARY / MODEL_FALLBACK 切換機制。
 */

const { MODEL_PRIMARY, MODEL_FALLBACK } = require('./ai-config');

// 底層共用的生成引擎 (支援雙備援)
async function generateDecision(genAI, modelName, prompt) {
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const tokens = result.response.usageMetadata?.totalTokenCount || 0;
        const text = result.response.text().trim();
        return { text, tokens, modelUsed: modelName };
    } catch (error) { throw error; }
}

async function detectIntent(genAI, userMsg, brandName, industry, superKeywords = [], chatHistory = []) {
    // 🌟 [記憶模組] 萃取「上一回合」的對話 (最多取最後 2 筆：User + AI)
    let recentContext = "";
    if (chatHistory && chatHistory.length >= 2) {
        const lastTurn = chatHistory.slice(-2);
        recentContext = `\n[CONTEXT FROM PREVIOUS TURN]\n`;
        lastTurn.forEach(msg => {
            const role = msg.role === 'model' ? 'AI' : 'User';
            const text = msg.parts?.[0]?.text || "";
            recentContext += `${role}: ${text}\n`;
        });
    }

    // 🌟 [Prompt 升級] 教導小腦同時抓取 MIN_PRICE 與 MAX_PRICE
    const prompt = `
You are a highly intelligent intent classification and keyword extraction routing engine for a SaaS platform.
Brand: ${brandName}
Industry: ${industry}

=== RULES ===
1. Analyze the [Current User Message], considering the [CONTEXT FROM PREVIOUS TURN] if provided.
2. Extract KEYWORDS (nouns, products, core concepts). DO NOT include verbs, conversational fillers, or numbers.
3. Extract PRICE RANGE as strict Arabic numbers. 
   - If user says "10000以上" or "超過10000" -> MIN_PRICE: 10000, MAX_PRICE: NONE
   - If user says "3000~5000" or "3000到5000" -> MIN_PRICE: 3000, MAX_PRICE: 5000
   - If user says "5000以內" or "低於5000" -> MIN_PRICE: NONE, MAX_PRICE: 5000
   - If user says exactly "5000元" -> MIN_PRICE: NONE, MAX_PRICE: 5000
   - If no budget mentioned -> MIN_PRICE: NONE, MAX_PRICE: NONE
4. Classify the INTENT into ONE of these: 
   - PRODUCT (Looking for products, asking about items, prices, or specs)
   - LOCATION (Asking for store locations, hours, physical presence)
   - LEADS (Complaints, returns, talking to a human, B2B/wholesale leads)
   - CHAT (General greetings, thanks, non-commercial small talk)

=== SUPER KEYWORDS (GOD MODE) ===
If the user's message contains ANY of these exact words: [${superKeywords.join(', ')}], you MUST classify the INTENT as "PRODUCT" and include the matched word in KEYWORDS, ignoring all other rules.

${recentContext}
[Current User Message]
User: ${userMsg}

Output Format (Strictly 4 parts separated by '|'):
INTENT | KEYWORDS | MIN_PRICE | MAX_PRICE
Example: PRODUCT | 烏龍茶, 禮盒 | 10000 | NONE
`;

    let text = "";
    let tokensUsed = 0;
    let finalModelUsed = MODEL_PRIMARY;

    try {
        // 🚀 [首選路徑] 嘗試使用 Primary 模型
        const result = await generateDecision(genAI, MODEL_PRIMARY, prompt);
        text = result.text;
        tokensUsed = result.tokens;
    } catch (errorPrimary) {
        console.warn(`[Router Warning] ⚠️ Primary 模型 (${MODEL_PRIMARY}) 異常或退役，自動切換至備援模型...`);
        
        try {
            // 🛡️ [備援路徑] 啟動 Fallback 模型
            finalModelUsed = MODEL_FALLBACK;
            const result = await generateDecision(genAI, MODEL_FALLBACK, prompt);
            text = result.text;
            tokensUsed = result.tokens;
        } catch (errorFallback) {
            // 🚨 雙重失效的最壞狀況，回傳安全預設值 (4個 NONE)
            console.error(`[Router Error] ❌ 雙模型皆失效！`);
            return { text: "CHAT | NONE | NONE | NONE", tokens: 0, modelUsed: "ERROR" };
        }
    }

    return {
        text: text,
        tokens: tokensUsed,
        modelUsed: finalModelUsed
    };
}

function parseRouterOutput(result, userMsg, customKeywords = []) {
    let cleanText = result.text.replace(/```[a-z]*\n?/gi, '').replace(/```/gi, '').trim();
    const parts = cleanText.split('|').map(s => s.trim());
    
    let intent = parts[0]?.toUpperCase() || "CHAT";
    let keywords = parts[1] || "";
    let minPriceStr = parts[2] || "NONE";
    let maxPriceStr = parts[3] || "NONE";
    
    // 🛠️ 價格解析邏輯 (保留 v4.3 優點)
    let minPrice = null;
    let maxPrice = null;
    const parseNum = (str) => {
        const n = parseInt(str.replace(/\D/g, ''), 10);
        return (!isNaN(n) && n > 0) ? n : null;
    };
    if (minPriceStr !== "NONE") minPrice = parseNum(minPriceStr);
    if (maxPriceStr !== "NONE") maxPrice = parseNum(maxPriceStr);

    // ==========================================
    // 🛡️ [護欄防禦 2.0] 意圖權重重分配
    // ==========================================

    // 1. 📍 [LOCATION 護欄] - 最高優先級 (確保 O2O 引流)
    const locationKeywords = [
        "哪裡有", "門市", "店面", "地址", "位置", "導航", "地圖", 
        "去哪買", "實體", "現場", "營業時間", "靠近", "店舖"
    ];
    const isActuallyLocation = locationKeywords.some(kw => userMsg.includes(kw));

    // 2. 🛍️ [PRODUCT 護欄] - 商業轉化 (剔除模糊的地點詞)
    const productKeywords = [
        "買", "多少錢", "價格", "推薦", "有貨", "怎麼賣", "預算", 
        "介紹", "款式", "目錄", "方案", "費用", "算力點", "PTS",
        "元", "以內", "以上", "以下", "區間", "商品", "找", "便宜", "貴"
    ];
    const strongProductKeywords = [...productKeywords, ...customKeywords];
    const isActuallyProduct = strongProductKeywords.some(kw => userMsg.includes(kw));

    // --- 決策鏈修正 ---
    if (isActuallyLocation) {
        // 如果偵測到地點詞，無視 CHAT/PRODUCT，強制轉為 LOCATION
        console.log(`[Router Guardrail] 📍 偵測到地點需求，修正為 LOCATION。UserMsg: "${userMsg}"`);
        intent = "LOCATION";
    } 
    else if (intent === "CHAT" && isActuallyProduct) {
        // 只有在非地點需求，且 LLM 判斷為 CHAT 時，才導向 PRODUCT
        console.log(`[Router Guardrail] 🚨 偵測到商品需求，修正為 PRODUCT。`);
        intent = "PRODUCT";
        if (!keywords || keywords === "NONE") keywords = userMsg;
    }

    // 最終象限限縮
    if (intent.includes("PRODUCT")) intent = "PRODUCT";
    else if (intent.includes("LOCATION")) intent = "LOCATION";
    else if (intent.includes("LEADS")) intent = "LEADS";
    else intent = "CHAT";

    console.log(`[Router v4.4] Intent: [${intent}], Keywords: [${keywords}], Price: ${minPrice}~${maxPrice}`);
    
    return { intent, keywords, tokens: result.tokens, modelUsed: result.modelUsed, minPrice, maxPrice };
}

module.exports = { detectIntent, parseRouterOutput };