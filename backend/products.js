/**
 * 🛍️ Products Module (products.js) - v2.8 SaaS Edition
 * ------------------------------------------------
 * [Upgrade] v2.8: 
 * 🌟 移除高風險的靜態 Stop Words，將「關鍵字純化」任務 100% 交給智能 Router 處理。
 * 🌟 參數優化：Threshold 0.55 (錯字容忍與防瞎平衡點) + ignoreLocation。
 * 🌟 新增：零結果智能保底 (Zero-Result Fallback)，找不到商品也絕不冷場。
 */

const Fuse = require("fuse.js");

function filterProducts(userQuery, allProducts, maxPrice = null) {
    if (!allProducts || allProducts.length === 0) return { matched: [], isFallback: false, maxPrice };
    if (!userQuery) return { matched: [], isFallback: false, maxPrice };

    // 🌟 1. 標籤大合體引擎 (Tag Union Engine)
    let processedProducts = allProducts.map(p => {
        const descriptionText = p.desc || p.description || ""; 
        
        // A. 抓取 desc 裡的手動標籤 (使用 Regex 確保中文也能抓到)
        const manualTags = descriptionText.match(/#[\w\u4e00-\u9fa5]+/g) || [];
        
        // B. 抓取 AI 視覺鋼印標籤 (直接讀取 Array，並補上 # 字號)
        const aiTags = (p.ai_system_audit && Array.isArray(p.ai_system_audit.ai_tags)) 
            ? p.ai_system_audit.ai_tags.map(t => `#${t}`) 
            : [];
            
        // C. 聯集去重：將手打標籤與 AI 標籤合而為一，餵給 Fuse 權重運算
        const combinedTags = [...new Set([...manualTags, ...aiTags])];

        return { 
            ...p, 
            desc: descriptionText, 
            tags: combinedTags.join(" "), // 將陣列轉為空格分隔的字串，方便 Fuse.js 檢索
            numPrice: Number(p.price) || 0 
        };
    });

    let isFallback = false;
    let fallbackReason = "";

    // 🌟 2. 數學預算過濾器
    if (maxPrice) {
        const withinBudget = processedProducts.filter(p => p.numPrice > 0 && p.numPrice <= maxPrice);
        if (withinBudget.length > 0) {
            processedProducts = withinBudget;
        } else {
            isFallback = true;
            fallbackReason = "BUDGET";
            processedProducts = [...processedProducts]
                .filter(p => p.numPrice > 0)
                .sort((a, b) => a.numPrice - b.numPrice)
                .slice(0, 3);
            return { matched: processedProducts, isFallback, maxPrice, fallbackReason }; 
        }
    }

    // 🚀 3. 搜尋配置：標籤 0.6 / 品名 0.4 (標籤現在包含了鋼印，威力大增！)
    const options = {
        includeScore: true,
        threshold: 0.55, 
        distance: 100,
        ignoreLocation: true, 
        keys: [
            { name: "tags", weight: 0.6 },
            { name: "name", weight: 0.4 }
        ]
    };

    const fuse = new Fuse(processedProducts, options);
    const result = fuse.search(userQuery);
    
    // 🌟 4. 零結果保底
    if (result.length === 0) {
        isFallback = true;
        fallbackReason = "NOT_FOUND";
        const hotProducts = [...processedProducts].slice(0, 3);
        return { matched: hotProducts, isFallback, maxPrice, fallbackReason };
    }
    
    // 🌟 5. [關鍵修正]：解除 5 筆封印，放寬到 15 筆，讓 AI 啟動標籤再歸納邏輯！
    const RAG_LIMIT = 15;

    return { 
        matched: result.map(r => ({ ...r.item, _fuseScore: r.score })).slice(0, RAG_LIMIT), 
        isFallback, 
        maxPrice, 
        fallbackReason: "" 
    };
}

function generateSystemPrompt(filterResult) {
    const { matched, isFallback, maxPrice, fallbackReason } = filterResult;
    let productInfo = "";
    
    if (matched && matched.length > 0) {
        productInfo = matched.map((p) => {
            const priceTag = p.price ? `$${p.price}` : "Price upon request";
            // 🚀 [省 Token 優化] 捨棄長篇大論的 desc，只餵給大腦「品名、價格、標籤」
            let info = `[${p.name}] - ${priceTag}`;
            if (p.tags) info += `\n  Tags: ${p.tags}`; 
            return info;
        }).join("\n\n");
    } else {
        productInfo = "No specific products found.";
    }

    // 🌟 針對不同 Fallback 情境的隱藏高情商劇本
    let fallbackScript = "";
    if (isFallback) {
        if (fallbackReason === "BUDGET") {
            fallbackScript = `
    [🚨 CRITICAL SYSTEM ALERT: BUDGET MISMATCH]
    - SITUATION: User's budget is $${maxPrice}, but premium items start higher.
    - YOUR MISSION: Politely inform the user our items start slightly higher. Pitch the entry-level products listed below.`;
        } else if (fallbackReason === "NOT_FOUND") {
            fallbackScript = `
    [🚨 CRITICAL SYSTEM ALERT: PRODUCT NOT FOUND]
    - SITUATION: The specific product the user asked for is NOT available or out of stock.
    - YOUR MISSION: 
      1. Politely and empathetically tell the user we currently don't have that specific item.
      2. IMMEDIATELY pivot and recommend the highly popular alternative products listed in the inventory below! Show high EQ.`;
        }
    }

    return `
    === PRODUCT INVENTORY (Dynamic) ===
    ${productInfo}
    
    === SALES & LEAD ENGINE (v2.8 SaaS) ===
    ${fallbackScript}
    `;
}

module.exports = { filterProducts, generateSystemPrompt };