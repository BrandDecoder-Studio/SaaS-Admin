/**
 * 🛠️ 向量狙擊 RAG 引擎 (rag-engine.js)
 * 🌟 [Update] 支援 MIN_PRICE / MAX_PRICE 絕對物理過濾與意圖澄清。
 * 🌟 [Update] 動態網眼放大：有價格條件時，檢索池放大到 50 以免漏掉極端價位商品。
 */
const admin = require("firebase-admin");
const products = require("./products"); 

// 注意：如果有用到全域模型，可以從這裡引入，或者維持您原本的做法
// const { MODEL_EMBEDDING } = require('./ai-config');

async function executeRagSearch(params) {
    let {
        db, clientId, genAI, extractedKeywords, hasSales, 
        currentMemberData, routerResponse, ledger
    } = params;

    let qaContext = "";
    let allProductsCache = [];
    let productsContext = "";

    try {
        // 🚀 Step 1: 一次性計算空間座標
        const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const embedResult = await embedModel.embedContent(extractedKeywords);
        const queryVector = admin.firestore.FieldValue.vector(embedResult.embedding.values.slice(0, 768));

        // 🚀 Step 2: 狙擊 QA
        try {
            const qaQuery = db.collection('clients').doc(clientId).collection('qa')
                .findNearest('embedding', queryVector, { limit: 2, distanceMeasure: 'COSINE' });
            const qaSnap = await qaQuery.get();
            ledger.reads += qaSnap.size;
            if (!qaSnap.empty) {
                qaContext = `[QA庫]\n${qaSnap.docs.map(d => `Q:${d.data().question}/A:${d.data().answer}`).join("\n")}\n`;
                ledger.details = (ledger.details ? ledger.details + " | " : "") + `QA_Hits[${qaSnap.size}]`;
            }
        } catch (qaErr) { console.warn("⚠️ QA 向量搜尋失敗:", qaErr.message); }

        // 🚀 Step 3: 商品 RAG - 意圖澄清與精準狙擊
        if (hasSales) {
            // 🛑 [核心升級 1] 反向收網：判斷是否只有預算沒有實體名詞
            const cleanKw = (routerResponse.keywords || "").replace(/[0-9~元塊錢以內以上以下左右價格預算區間上下商品東西的有沒有找買]/g, "").trim();
            const hasBudget = routerResponse.maxPrice !== null || routerResponse.minPrice !== null;
            const isOnlyBudget = hasBudget && (cleanKw === "" || cleanKw === "NONE" || cleanKw.length === 0);

            if (isOnlyBudget) {
                let budgetText = "";
                if (routerResponse.minPrice && routerResponse.maxPrice) budgetText = `${routerResponse.minPrice}到${routerResponse.maxPrice}元`;
                else if (routerResponse.maxPrice) budgetText = `${routerResponse.maxPrice}元以內`;
                else if (routerResponse.minPrice) budgetText = `${routerResponse.minPrice}元以上`;

                console.log(`[RAG Engine] 🛑 觸發意圖澄清！客人只給預算 (${budgetText})，沒有具體名詞。`);
                productsContext = `=== SYSTEM ALERT ===\nThe user provided a budget limit of ${budgetText}, but did NOT specify any product name, material, or category.\nDO NOT recommend random products. DO NOT hallucinate. Please politely acknowledge their budget and ASK them to clarify their needs (e.g., "這預算區間有很多優質選擇，請問您想找哪一種茶？或是想要找什麼用途的禮盒呢？").`;
                if (ledger.action !== "AI_VISION_SEARCH") ledger.action = "AI_CLARIFY_NEEDS";
                
            } else {
                // ==========================================================
                // 🛡️ [總監加碼：SaaS 上下架連動防護網] 建立分類黑名單
                // ==========================================================
                const inactiveCatIds = new Set();
                try {
                    const catSnap = await db.collection('clients').doc(clientId).collection('categories').get();
                    catSnap.forEach(doc => {
                        const data = doc.data();
                        // 只要被明確標記為下架 (is_active: false 或 listing: false)，就列入黑名單
                        if (data.is_active === false || data.listing === false) {
                            inactiveCatIds.add(doc.id);
                        }
                    });
                } catch(e) { 
                    console.warn("⚠️ [RAG] 讀取分類黑名單失敗", e); 
                }
                // ==========================================================

                // 🚀 [核心升級 2] 擴大檢索池：有價格限制時放寬到 50 筆
                const fetchLimit = hasBudget ? 50 : 30;

                const vectorQuery = db.collection('clients').doc(clientId).collection('products')
                    .where('listing', '==', true)
                    .findNearest('embedding', queryVector, { limit: fetchLimit, distanceMeasure: 'COSINE' });

                const vectorSnap = await vectorQuery.get();
                ledger.reads += vectorSnap.size; 

                if (!vectorSnap.empty) {
                    let matchedProducts = vectorSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                    // 🛡️ CRM 身分過濾
                    const userLevel = currentMemberData.level || "一般";
                    const userNote = (currentMemberData.note || "").toLowerCase();
                    const isVeteran = userNote.includes('非新手') || userNote.includes('已開通') || userNote.includes('老客');

                    // 🛡️ 絕對物理過濾 (包含上下架連動)
                    matchedProducts = matchedProducts.filter(p => {
                        const desc = p.desc || p.description || "";
                        if (desc.includes('#VIP') || desc.includes('#VIP限定')) { if (userLevel !== 'VIP') return false; }
                        if (desc.includes('#新手') || desc.includes('#新客戶') || desc.includes('#新人')) { if (isVeteran) return false; }
                        
                        // 🌟 [上下架黑名單狙擊]：檢查該商品的大分類或小分類是否已被下架
                        if (p.main_category_id && inactiveCatIds.has(p.main_category_id)) return false;
                        if (p.sub_category_id && inactiveCatIds.has(p.sub_category_id)) return false;

                        // 🌟 絕對價格封殺
                        const pPrice = p.price || 0;
                        if (routerResponse.maxPrice && pPrice > routerResponse.maxPrice) return false;
                        if (routerResponse.minPrice && pPrice < routerResponse.minPrice) return false;

                        // 🌟 [新增] SaaS 級精準分類攔截器 (物理短路)
                        if (routerResponse.exactMatchFilter) {
                            const exact = routerResponse.exactMatchFilter;
                            if (exact.type === 'main') {
                                if (p.main_category_id !== exact.id) return false; // 不是這館的，殺！
                            } else if (exact.type === 'sub') {
                                if (p.main_category_id !== exact.main_id || p.sub_category_id !== exact.sub_id) return false; // 跨館或非此小分類，殺！
                            }
                        }
                        
                        return true;
                    });

                    // 🎯 預算感知重排
                    if (hasBudget) {
                        if (routerResponse.maxPrice) {
                            matchedProducts.sort((a, b) => (b.price || 0) - (a.price || 0));
                        } else if (routerResponse.minPrice) {
                            matchedProducts.sort((a, b) => (a.price || 0) - (b.price || 0));
                        }
                    }

                    // 🎯 [總監優化]：放寬視角上限並執行「Token 瘦身工程」
                    const RAG_FLEX_LIMIT = 15; 
                    matchedProducts = matchedProducts.slice(0, RAG_FLEX_LIMIT).map(p => {
                        const rawDesc = p.desc || p.description || "";
                        
                        // 1. 物理榨汁機：用 Regex 把所有 #標籤 抽出來
                        const tagMatch = rawDesc.match(/#[\w\u4e00-\u9fa5]+/g);
                        const extractedTags = tagMatch ? tagMatch.join(" ") : "";
                        
                        // 2. 整合 AI 視覺審核標籤 (🌟 加入 Array 嚴謹檢查防崩潰)
                        let aiTags = "";
                        if (p.ai_system_audit && Array.isArray(p.ai_system_audit.ai_tags)) {
                            aiTags = p.ai_system_audit.ai_tags.map(t => `#${t}`).join(" ");
                        }

                        // 3. 垃圾文字切除：只留 40 字簡介，其餘由「標籤特徵」取代
                        const slimDesc = rawDesc.replace(/#[\w\u4e00-\u9fa5]+/g, '').trim().substring(0, 40);
                        
                        return {
                            ...p,
                            desc: `${slimDesc}... [標籤特徵]: ${aiTags} ${extractedTags}`.trim()
                        };
                    });

                    allProductsCache = matchedProducts; // 存入清洗後的精簡緩存

                    // 🌟 [總監加強：物理計數與防迷路鋼印] 
                    const currentLocation = routerResponse.keywords || cleanKw || "未指定";
                    const realProductCount = matchedProducts.length;
                    const countHeader = `\n\n=== 🚨 [KNOWLEDGE BASE CRITICAL DATA] ===\n[CURRENT_LOCATION]: ${currentLocation}\n[CURRENT_CANDIDATE_COUNT]: ${realProductCount}\n`;

                    if (matchedProducts.length > 0) {
                        // 🌟 強行把 Header 縫合在系統指令最前方
                        productsContext = countHeader + products.generateSystemPrompt({ matched: matchedProducts, isFallback: false, maxPrice: routerResponse.maxPrice }); 
                        ledger.details = (ledger.details ? ledger.details + " | " : "") + `RAG_Hits[${matchedProducts.length}]`;
                        if (ledger.action !== "AI_VISION_SEARCH") ledger.action = "AI_PRODUCT_FILTERED";
                    } else {
                        productsContext = products.generateSystemPrompt({ matched: [], isFallback: false, maxPrice: routerResponse.maxPrice }); 
                        if (ledger.action !== "AI_VISION_SEARCH") ledger.action = "AI_CONSULTING_ONLY";
                    }
                } else {
                    productsContext = products.generateSystemPrompt({ matched: [], isFallback: false, maxPrice: routerResponse.maxPrice }); 
                    if (ledger.action !== "AI_VISION_SEARCH") ledger.action = "AI_CONSULTING_ONLY";
                }
            }
        }
    } catch (ragError) {
        console.error("⚠️ [RAG Search Error] 向量搜尋整體失敗:", ragError.message);
        productsContext = products.generateSystemPrompt({ matched: [], isFallback: false, maxPrice: routerResponse.maxPrice });
        if (ledger.action !== "AI_VISION_SEARCH") ledger.action = "AI_CONSULTING_ONLY";
        ledger.details = (ledger.details ? ledger.details + " | " : "") + "RAG_Failed";
    }

    return { qaContext, allProductsCache, productsContext, updatedLedger: ledger };
}

module.exports = { executeRagSearch };