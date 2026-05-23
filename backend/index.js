/**
 * index.js - BrandDecoder SaaS Webhook (v24.2.4 - Ultimate Defense & Cross-Selling)
 * ------------------------------------------------
 * 🌟 [v24.2.4] 新增：無痕推薦模組、重選物理短路防線、終極標籤解析器、足跡 GC 機制。
 * 🌟 [v24.2.3] 引入 salesfunnel.js，實裝仿人情境逼單機制與漏斗鎖定。
 * 🌟 [v24.2.2] 終極大掃除：將所有商機、冷卻、QuickReply 邏輯解耦至 leads.js。
 * 🌟 [總監升級] 導入「二刀流狀態機」：精準辨識點擊(Postback)與手打，實作漏斗記憶繼承與無痕斷捨離機制。
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore"); 
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const crypto = require("crypto"); 
const Fuse = require("fuse.js"); 
const { CloudTasksClient } = require("@google-cloud/tasks"); 

const { MODEL_PRIMARY, MODEL_FALLBACK } = require('./ai-config');

// --- 引入本地模組 ---
const hawkEye = require("./hawk-eye"); 
const lineUI = require("./line-ui");   
const billing = require("./billing");  
const router = require("./router");     
const maps = require("./maps");         
const gle = require("./gle-engine");
const crm = require("./crm");
const promptEngine = require("./prompt-engine"); 
const products = require("./products");  
const saasApi = require("./saas-api"); 
const showroomController = require("./showroom-controller"); 
const ragEngine = require("./rag-engine"); 
const leads = require("./leads"); // 商機獵人模組
const salesfunnel = require("./salesfunnel"); // 仿人情境逼單機制

const SYSTEM_VERSION = "v24.2.4"; 
const PROJECT_ID = "lllcnd"; 
const REGION = "asia-east1"; 

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore(admin.app(), "branddecoder-saas-db");
const tasksClient = new CloudTasksClient(); 


// ==========================================================
// 🧠 輔助函數區
// ==========================================================

async function getChatHistory(clientRef, userId, memoryLength = 6) {
    try {
        if (memoryLength <= 0) return [];
        const snap = await clientRef.collection('members').doc(userId).collection('history')
            .orderBy('timestamp', 'desc')
            .limit(memoryLength)
            .get();

        return snap.docs.map(d => {
            const data = d.data();
            let content = data.content || "";
            // 防止 AI 歷史紀錄過長浪費 Token
            if (data.role === 'AI' && content.length > 60) {
                content = content.substring(0, 60) + "...(略)";
            }
            return { 
                role: data.role === 'AI' ? 'model' : 'user', 
                parts: [{ text: content }] 
            };
        }).reverse();
    } catch (e) { 
        return []; 
    }
}

async function saveChatHistory(clientRef, userId, userText, aiText) {
    try {
        const historyRef = clientRef.collection('members').doc(userId).collection('history');
        const now = admin.firestore.FieldValue.serverTimestamp();
        const expireTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天後過期，配合 TTL
        
        const batch = db.batch();
        batch.set(historyRef.doc(), { role: 'User', content: userText, timestamp: now, expireAt: expireTime });
        if (aiText) {
            batch.set(historyRef.doc(), { role: 'AI', content: aiText, timestamp: now, expireAt: expireTime });
        }
        await batch.commit();
    } catch (e) {}
}

async function getUserProfile(userId, channelAccessToken) {
    if(!channelAccessToken) return null;
    try {
        const url = `https://api.line.me/v2/bot/profile/${userId}`;
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${channelAccessToken}` } });
        return response.data;
    } catch (error) { 
        return null; 
    }
}

async function generateWithFallback(genAI, prompt) {
    try {
        const modelPrimary = genAI.getGenerativeModel({ model: MODEL_PRIMARY });
        const result = await modelPrimary.generateContent(prompt);
        return { result, modelUsed: MODEL_PRIMARY };
    } catch (error) {
        console.warn(`[${SYSTEM_VERSION}] ⚠️ Primary Model Failed. Switching to Fallback.`);
        const modelFallback = genAI.getGenerativeModel({ model: MODEL_FALLBACK });
        const result = await modelFallback.generateContent(prompt);
        return { result, modelUsed: MODEL_FALLBACK + " (Fallback)" };
    }
}


// ============================================================================
// 📊 [模組] 銷售漏斗足跡追蹤與自動清理 (Funnel Impression & GC)
// ============================================================================
async function updateFunnelImpression(clientRef, userId, docId, itemName, type) {
    try {
        const memberRef = clientRef.collection('members').doc(userId);
        
        const safeDocId = docId ? String(docId).replace(/[.#$/[\]]/g, '_') : 'unknown_id';

        await db.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(memberRef);
            let currentFunnel = docSnap.exists ? (docSnap.data().funnel_state || {}) : {};

            const now = Date.now();
            const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

            currentFunnel[safeDocId] = { 
                type: type, 
                name: itemName || "未命名項目", 
                last_impression_at: now, 
                clicked: false, 
                lead_submitted: false 
            };

            let keys = Object.keys(currentFunnel);
            let validKeys = keys.filter(k => (now - currentFunnel[k].last_impression_at) < THIRTY_DAYS_MS);
            
            validKeys.sort((a, b) => currentFunnel[b].last_impression_at - currentFunnel[a].last_impression_at);

            const MAX_LIMIT = 20;
            const keysToKeep = validKeys.slice(0, MAX_LIMIT);

            const updateData = { funnel_state: {} };

            keysToKeep.forEach(k => { 
                updateData.funnel_state[k] = currentFunnel[k]; 
            });

            keys.forEach(k => {
                if (!keysToKeep.includes(k)) {
                    updateData.funnel_state[k] = admin.firestore.FieldValue.delete();
                }
            });

            transaction.set(memberRef, updateData, { merge: true });
        });
        
    } catch (e) {
        console.warn("⚠️ [GC Error] Funnel Log 寫入與清理異常:", e.message);
    }
}


// ==========================================================
// 🗂️ 菜單打包機 (SaaS 標籤導航強化版 + 🌟 支援上下架過濾 + 狀態追蹤)
// ==========================================================
async function getCategoryContext(clientRef, builderSettings) {
    try {
        const snap = await clientRef.collection('categories').get();
        if (snap.empty) return { menuStr: "", rawMainCats: [], rawSubCats: {} };

        let mainCats = [];
        let subCats = {}; 

        snap.forEach(doc => {
            const cat = { id: doc.id, ...doc.data() };
            
            if (cat.is_active === false || cat.listing === false) return;

            if (cat.parent_id) {
                if (!subCats[cat.parent_id]) subCats[cat.parent_id] = [];
                subCats[cat.parent_id].push(cat); 
            } else {
                mainCats.push(cat);
            }
        });

        const layer1 = builderSettings?.funnel_layer1 || "大分類";
        const layer2 = builderSettings?.funnel_layer2 || "小分類";

        let menuStr = `=== 🗂️ 商店導航架構 (STORE STRUCTURE) ===\n`;
        menuStr += `[層級定義]: 第一層為「${layer1}」，第二層為「${layer2}」。\n\n`;
        
        const mainCatNames = mainCats.map(m => m.name);
        menuStr += `[第一層根目錄 (RESET_OPTIONS)]: ${JSON.stringify(mainCatNames)}\n\n`;

        menuStr += `[詳細結構清單]:\n`;
        mainCats.forEach(main => {
            let subs = subCats[main.id] || [];
            menuStr += `- ${layer1}: ${main.name}`;
            if (subs.length > 0) {
                menuStr += ` (包含 ${layer2}: ${subs.map(s => s.name).join(', ')})`;
            }
            menuStr += `\n`;
        });

        return { menuStr, rawMainCats: mainCats, rawSubCats: subCats };
    } catch (e) {
        console.warn("⚠️ 讀取分類菜單失敗", e);
        return { menuStr: "", rawMainCats: [], rawSubCats: {} };
    }
}


// ====================================================================
// 🟢 Webhook 主入口 
// ====================================================================
exports.webhook = functions.https.onRequest(async (req, res) => {
    // CORS 設定
    res.set('Access-Control-Allow-Origin', '*'); 
    if (req.method === 'OPTIONS') { 
        res.set('Access-Control-Allow-Methods', 'POST'); 
        res.set('Access-Control-Allow-Headers', 'Content-Type'); 
        return res.status(204).send(''); 
    }
    
    // SaaS API 路由攔截
    if (req.query.action) return await saasApi.handleApiRequests(req, res, db, SYSTEM_VERSION);

    // 初始化計費 Ledger 與基礎變數
    const traceId = req.get('Function-Execution-Id') || `tr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    let ledger = { traceId, reads: 0, tokens: 0, action: "UNKNOWN", status: "SUCCESS", details: "", ai_model: "", hasTgSummary: false };
    
    let clientId = null, replyToken = null, userId = "", userMsg = "", historyUserMsg = "", msgType = ""; 
    let clientData = null, clientDoc = null, lineDisplayName = "貴賓", linePictureUrl = "";
    let routerModel = "skipped", intentResult = "UNKNOWN", currentMemberData = {}; 

    // 🌟 [總監升級] 漏斗點擊判定旗標
    let isFunnelClick = false; 

    try {
        const event = req.body.events?.[0];
        const botDestination = req.body.destination; 
        if (!event) return res.status(200).send("OK");

        replyToken = event.replyToken; 
        userId = event.source.userId;
        
        if (event.source && event.source.type !== 'user') return res.status(200).send("Ignored");
        if (event.type !== 'message' && event.type !== 'postback') return res.status(200).send("OK");
        
       // 🌟 [總監升級] 解析訊息類型與內容 (二刀流分流閘道)
        // 🌟 1. 宣告回合隔離標籤 (預設為 false，用來保護展示間等獨立功能)
        let isExclusiveAction = false; 

        if (event.type === 'message') {
            msgType = event.message.type;
            if (!['text', 'image', 'location'].includes(msgType)) return res.status(200).send("OK"); 
            
            userMsg = event.message.text || "";
            if (msgType === 'location') userMsg = "📍【分享了地理位置】";
            if (msgType === 'image') userMsg = "🖼️【上傳了圖片素材】";
            historyUserMsg = userMsg;

        } else if (event.type === 'postback') {
            msgType = 'text'; // 偽裝成 text，讓後續的 Router 與 RAG 能正常處理語意
            const postbackParams = new URLSearchParams(event.postback.data);
            
            // 🚨 觸發展示間專屬通道
            if (postbackParams.get('action') === 'start_showroom') {
                isExclusiveAction = true;
                userMsg = `🪄【啟動沉浸展示間: ${postbackParams.get('productId') || '未知商品'}】`;
                historyUserMsg = userMsg;
            } 
            // 🎯 命中漏斗 QR
            else if (postbackParams.get('action') === 'filter_click') {
                isFunnelClick = true;
                userMsg = postbackParams.get('value') || "";
                historyUserMsg = `🖱️【點擊漏斗標籤: ${userMsg}】`;
                
                // 🌟 [總監升級：強制導流]
                intentResult = "PRODUCT"; 
                
                // 📡 [防呆雷達] 印出這行，證明新程式真的有燒進去！
                console.log(`🚀 [Postback 攔截] 已強制將意圖轉為 PRODUCT，準備進入 RAG 引擎！標籤: ${userMsg}`);
            } 
            // ==========================================================
            // 🌟 [總監修復：爆款看板斷層] 攔截商品卡片點擊 (拋單/購買)
            // ==========================================================
            else if (['buy', 'order', 'checkout', 'view_item'].includes(postbackParams.get('action'))) {
                isExclusiveAction = true; // 視為獨立專屬動作，準備物理結紮
                
                // 抓取按鈕帶過來的商品名稱 (請依據您 lineUI.js 實際的參數名稱調整，通常是 item 或 id)
                const itemName = postbackParams.get('item') || postbackParams.get('name') || "特定商品"; 
                
                userMsg = `🛒【顧客點擊了購買按鈕: ${itemName}】`;
                historyUserMsg = userMsg;

                // 🔌 接上看板電源：強制寫入爆款排行認得的「轉換標籤」
                ledger.action = "AI_PRODUCT_CONVERSION"; 
                ledger.details = `Converted: ${itemName}`;

                // (可選) 順便更新漏斗狀態為 clicked: true
                try {
                    await updateFunnelImpression(db, userId, itemName, itemName, 'CONVERSION');
                } catch(e) {}

                // ✂️ 直接發送導購結語並斬斷 AI，省下算力！
                await axios.post('https://api.line.me/v2/bot/message/reply', { 
                    replyToken, 
                    messages: [{ 
                        type: 'text', 
                        text: `🎉 感謝您對「${itemName}」感興趣！\n請直接在此留下您的【姓名與電話】，我們的專員會立即為您保留優惠與安排後續！` 
                    }] 
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });

                console.log(`📈 [轉換達成] 成功拋單！商品: ${itemName} | 標籤: AI_PRODUCT_CONVERSION`);
                return; // 物理結紮，不進 Gemini
            }
            // 其他一般按鈕 (未知的 Postback)
            else {
                userMsg = `🖱️【點擊選單按鈕: ${postbackParams.get('action') || '未知'}】`;
                historyUserMsg = userMsg;
            }
        }

        // 🌟 路由與金鑰驗證 (Client 識別)
        const cid = req.query.cid; 
        if (cid) {
            clientDoc = await db.collection('clients').doc(cid).get();
            if (!clientDoc.exists) return res.status(403).send("Client Not Found");
            clientId = clientDoc.id; 
            clientData = clientDoc.data();
            
            if (botDestination && clientData.lineBotId !== botDestination) { 
                await clientDoc.ref.update({ lineBotId: botDestination }); 
                clientData.lineBotId = botDestination; 
            }
        } else if (botDestination) {
            const clientsSnap = await db.collection('clients').where('lineBotId', '==', botDestination).limit(1).get();
            if(clientsSnap.empty) return res.status(403).send("Client Not Found");
            clientDoc = clientsSnap.docs[0]; 
            clientId = clientDoc.id; 
            clientData = clientDoc.data();
        } else {
            return res.status(400).send("No Routing Info"); 
        }

        // 取得金鑰與 Token
        try {
            const secretSnap = await db.collection('clients').doc(clientId).collection('secrets').doc('keys').get();
            const s = secretSnap.data();
            if (!s?.channelAccessToken || !s?.geminiApiKey) return res.status(403).send("Incomplete Keys"); 
            clientData.channelAccessToken = s.channelAccessToken; 
            clientData.channelSecret = s.channelSecret; 
            clientData.geminiApiKey = s.geminiApiKey;
        } catch (vErr) { 
            return res.status(500).send("Internal Server Error"); 
        }

        const genAI = new GoogleGenerativeAI(clientData.geminiApiKey); 
        ledger.reads += 1;

        // 🌟 多國語言 (GLE) 的算力加乘計算
        let calculatedWeight = 1.0; 
        const builderSettings = clientData.builder_settings || {};
        let rawLangs = builderSettings.gleSelectedLanguages;
        
        if (rawLangs && !Array.isArray(rawLangs) && typeof rawLangs === 'object') {
            rawLangs = Object.values(rawLangs);
        }
        
        if (Array.isArray(rawLangs)) {
            if (rawLangs.includes("Global")) {
                calculatedWeight = 1.05; 
            } else {
                const extraLangs = rawLangs.filter(lang => lang !== 'zh-TW' && lang !== 'Global');
                if (extraLangs.length > 0) {
                    calculatedWeight = Number((1.0 + (extraLangs.length * 0.01)).toFixed(2));
                }
            }
        }
        ledger.gleWeight = calculatedWeight; 
        ledger.useGLE = calculatedWeight > 1.0;

        // LINE 數位簽章驗證
        if (clientData.channelSecret && req.rawBody) {
            const hash = crypto.createHmac('sha256', clientData.channelSecret).update(req.rawBody.toString()).digest('base64');
            if (hash !== req.headers['x-line-signature']) return res.status(403).send("Invalid Signature");
        }

        // 檢查餘額與帳號狀態
        if ((clientData.balance_points || 0) <= 0 || (clientData.status && clientData.status.toUpperCase() !== "ACTIVE")) { 
            clientId = null; 
            return res.status(200).send("OK/Suspended"); 
        }

        // 模組啟用狀態檢查
        const activeEngines = clientData.builder_settings?.activeEngines || ['Sales', 'O2O', 'Service'];
        const hasSales = activeEngines.includes('Sales');
        const hasO2O = activeEngines.includes('O2O');
        const hasService = activeEngines.includes('Service'); // 🤝 真人商機（後台 eng-service）

        // 顧客資料處理與 CRM 同步
        if (userId) {
            const profile = await getUserProfile(userId, clientData.channelAccessToken);
            if (profile) { 
                lineDisplayName = profile.displayName || "Line User"; 
                linePictureUrl = profile.pictureUrl || ""; 
            }
            
            const memberSnap = await db.collection('clients').doc(clientId).collection('members').doc(userId).get();
            if (memberSnap.exists) {
                currentMemberData = memberSnap.data();
                if (currentMemberData.is_manual_mode === true) { 
                    clientId = null; 
                    return res.status(200).send("Manual Mode Active"); 
                }
            }
            // 背景非同步更新 CRM 資訊
            crm.updateMember(db, clientId, userId, lineDisplayName, linePictureUrl).catch(e => {});
        }

        // 🌟 展示間攔截控制器 (終極修復版)
        const showroomResult = await showroomController.handleShowroom({ 
            req, 
            event, 
            // 🚨 修正1：如果是專屬動作(展示間)，恢復它的 postback 身份，不要傳假 text 騙它
            msgType: isExclusiveAction ? 'postback' : msgType, 
            userMsg: userMsg, 
            replyToken, userId, clientId, clientData, currentMemberData, db, tasksClient, PROJECT_ID, REGION, ledger, SYSTEM_VERSION 
        });

        // 🛑 [總監級物理結紮] 
        // 修正2：只要展示間處理了，或者這本來就是個「專屬動作」，絕對不准往下走！
        if (showroomResult.handled || isExclusiveAction) { 
            console.log("🛡️ [展示間結案] 已觸發專屬動作，強制終止後續 AI 流程。");
            ledger = showroomResult.ledger; 
            return; // ✂️ 在這裡直接斬斷，省下 1111 點！
        }

        let extractedKeywords = userMsg;
        let routerResponse = { intent: "UNKNOWN", keywords: userMsg, tokens: 0, modelUsed: "skipped", maxPrice: null };

        // 🦅 鷹眼視覺分析攔截
        if (msgType === 'image') {
            const hawkAnalysis = await hawkEye.analyzeImage(event.message?.id || "", clientData.channelAccessToken, genAI);
            routerModel = `HawkEye_${hawkAnalysis.modelUsed || MODEL_PRIMARY}`; 
            ledger.tokens += (hawkAnalysis.tokens || 0); 
            ledger.details = (ledger.details ? ledger.details + " | " : "") + `HawkEye_${hawkAnalysis.intent}`;
            
            if (hawkAnalysis.intent === "CONTEXT_SCENE" || hawkAnalysis.intent === "PRODUCT_SKU") { 
                userMsg = hawkAnalysis.search_keywords || hawkAnalysis.features || "找商品"; 
                intentResult = "PRODUCT"; 
                extractedKeywords = userMsg; 
                historyUserMsg = `【上傳圖片搜尋】`; 
                ledger.action = "AI_VISION_SEARCH"; 
            } else { 
                intentResult = "CHAT"; 
                userMsg = "[SYSTEM_INJECT] 我上傳了無關圖片，請委婉告知。"; 
                historyUserMsg = "【上傳無關圖片】"; 
                ledger.action = "AI_VISION_BLOCKED"; 
            }
        }

        // 📍 O2O GPS 座標攔截
        if (msgType === 'location') {
            if (!hasO2O) {
                const qrData = await leads.getLeadQuickReply(clientData, currentMemberData, false);
                await axios.post('https://api.line.me/v2/bot/message/reply', { 
                    replyToken, 
                    messages: [{ type: 'text', text: "目前我們以雲端專業諮詢為主，暫無實體店面。", quickReply: qrData }] 
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
                
                ledger.action = "AI_CONSULTING_ONLY"; 
                return;
            }
            
            const nearestStore = maps.findNearestStore(event.message.latitude, event.message.longitude, clientData.builder_settings?.stores || []);
            if (nearestStore) {
                const mapFlex = await lineUI.createMapFlex([{ 
                    name: nearestStore.name, 
                    addressText: `${nearestStore.displayAddr || nearestStore.address} (距離 ${nearestStore.distance} km)`, 
                    mapUrl: nearestStore.mapLink || `http://maps.google.com/?q=${nearestStore.lat},${nearestStore.lng}` 
                }], { cid: clientId, uid: userId, tid: traceId });
                
                await axios.post('https://api.line.me/v2/bot/message/reply', { 
                    replyToken, 
                    messages: [ { type: 'text', text: `📍 最近門市是【${nearestStore.name}】` }, mapFlex ] 
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
                
                await updateFunnelImpression(clientDoc.ref, userId, nearestStore.name, nearestStore.name, 'MAP'); 
                ledger.action = "AI_MAP_SEARCH"; 
                return;
            } else {
                await axios.post('https://api.line.me/v2/bot/message/reply', { 
                    replyToken, 
                    messages: [{ type: 'text', text: "附近目前沒有服務據點。" }] 
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
                
                ledger.action = "AI_MAP_NOT_FOUND"; 
                return;
            }
        }

        // 🚦 漏斗鎖定檢查 (Funnel Lock)
        let isLocked = false;
        if (msgType === 'text') {
            isLocked = salesfunnel.isFunnelLocked(userMsg, currentMemberData.showroom_state);
            if (isLocked) {
                console.log(`🔒 [SalesFunnel] 命中導購/展示鎖定，略過 Leads 與 Router 判定。`);
                intentResult = "PRODUCT"; // 強制鎖定為產品導購意圖
                extractedKeywords = userMsg;
                routerModel = "FunnelLocked";
            }
        }

        // 🌟 呼叫商機獵人模組 (Leads.js) — 須啟用「真人商機」引擎
        if (hasService && !isLocked) {
            const leadResult = await leads.checkAndCapture({ 
                db, userMsg, historyUserMsg, userId, lineDisplayName, linePictureUrl, 
                clientId, clientData, clientDoc, replyToken, genAI, ledger, 
                saveChatHistoryFn: saveChatHistory 
            });
            if (leadResult.captured) { 
                ledger = leadResult.ledger; 
                return; 
            }
        }

        // 🚦 小腦意圖分流 (Router)
        if (msgType === 'text' && !isLocked && intentResult === "UNKNOWN") {
            if (hasService && userMsg.includes("我需要專人服務")) { 
                intentResult = "LEADS"; 
                routerModel = "ExactMatch"; 
            } else {
                try {
                    const chatHistory = await getChatHistory(clientDoc.ref, userId, 2); 
                    const rawRouterResult = await router.detectIntent(genAI, userMsg, clientData.brandName || "店鋪", clientData.builder_settings?.industry || "零售", (clientData.builder_settings?.super_keywords || "").split(',').filter(k => k.trim()), chatHistory);
                    
                    routerResponse = router.parseRouterOutput(rawRouterResult, userMsg, []);
                    intentResult = routerResponse.intent; 
                    extractedKeywords = routerResponse.keywords; 
                    routerModel = routerResponse.modelUsed;
                } catch (err) { 
                    intentResult = "CHAT"; 
                    extractedKeywords = userMsg; 
                }
            }
        }

        ledger.tokens += (routerResponse.tokens || 0); 
        if (intentResult === "CHAT") {
            ledger.action = "AI_CHAT_ONLY"; 
        } else if (intentResult === "PRODUCT" && ledger.action === "UNKNOWN") {
            ledger.action = "AI_PRODUCT_SEARCH"; 
        }

        // 後台關閉「真人商機」時，Router 若仍判 LEADS → 改走一般對話，不發專員卡
        if (intentResult === "LEADS" && !hasService) {
            console.log("🚫 [Leads] Service 引擎已關閉，略過 LEADS 引導卡。");
            intentResult = "CHAT";
            ledger.action = "AI_CHAT_ONLY";
        }

        // 🪓 LEADS 意圖斷路器
        if (intentResult === "LEADS" && hasService) {
            const leadGuidanceMsg = leads.getLeadGuidanceFlexMessage();
            const qrData = await leads.getLeadQuickReply(clientData, currentMemberData, false);
            
            if (qrData) leadGuidanceMsg.quickReply = qrData;
            
            await axios.post('https://api.line.me/v2/bot/message/reply', { 
                replyToken, 
                messages: [leadGuidanceMsg] 
            }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
            
            await saveChatHistory(clientDoc.ref, userId, historyUserMsg, "【發送專員聯繫引導卡片】"); 
            ledger.action = "AI_LEAD_GUIDANCE"; 
            ledger.ai_model = `Router: ${routerModel} | Chat: Skipped`; 
            return; 
        }

        // 🔪 RAG 引擎與菜單準備 (🌟 SaaS 級精準打擊與狀態記憶)
        let productsContext = "", allProductsCache = [], qaContext = "";
        let categoryContext = ""; 

        if (intentResult === "PRODUCT") {
            // 🌟 1. [先發制人] 先撈取分類菜單，建構系統的「空間認知」
            const catData = await getCategoryContext(clientDoc.ref, clientData.builder_settings);
            categoryContext = catData.menuStr;
            const rawMainCats = catData.rawMainCats;
            const rawSubCats = catData.rawSubCats;

            // 🌟 2. [狀態追蹤大腦] 解析客人目前的位置
            const userMsgTrimmed = userMsg.trim();
            let contextSlots = currentMemberData.context_slots || {};
            let exactMatchFilter = null;

            const matchedMainCat = rawMainCats.find(c => c.name === userMsgTrimmed);
            let matchedSubCat = null;
            let matchedParentId = null;

            // A. 檢查是否命中「大分類」
            if (matchedMainCat) {
                contextSlots.current_main_cat_id = matchedMainCat.id;
                contextSlots.current_main_cat_name = matchedMainCat.name;
                delete contextSlots.current_sub_cat_id; // 進入大分類，清除舊的小分類足跡
                delete contextSlots.current_sub_cat_name;
                exactMatchFilter = { type: 'main', id: matchedMainCat.id };
                console.log(`📍 [導航追蹤] 鎖定大分類: ${matchedMainCat.name}`);
            } else {
                // B. 檢查是否命中「小分類」
                for (const pid in rawSubCats) {
                    const sub = rawSubCats[pid].find(s => s.name === userMsgTrimmed);
                    if (sub) {
                        matchedSubCat = sub;
                        matchedParentId = pid;
                        break;
                    }
                }

                if (matchedSubCat) {
                    contextSlots.current_sub_cat_id = matchedSubCat.id;
                    contextSlots.current_sub_cat_name = matchedSubCat.name;
                    
                    // 🌟 跨館防呆：強制校正大分類
                    if (contextSlots.current_main_cat_id !== matchedParentId) {
                        contextSlots.current_main_cat_id = matchedParentId;
                        const parentMain = rawMainCats.find(c => c.id === matchedParentId);
                        contextSlots.current_main_cat_name = parentMain ? parentMain.name : "未知";
                    }
                    
                    exactMatchFilter = { 
                        type: 'sub', 
                        main_id: contextSlots.current_main_cat_id, 
                        sub_id: matchedSubCat.id 
                    };
                    console.log(`📍 [導航追蹤] 鎖定小分類: ${matchedSubCat.name} (隸屬: ${contextSlots.current_main_cat_name})`);
                } else {
                    // 🌟 C. [總監升級] 既不是大分類也不是小分類 (二刀流審判)
                    if (isFunnelClick) {
                        // 🛡️ [左派：絕對信任] 客人點擊了按鈕
                        
                        // 💡 [修復：大分類的重新鎖定] 
                        // 如果他點的是大分類的名稱 (例如"玩具")，但因為漏斗重新開始導致前面沒抓到，
                        // 我們要在這裡「強制補救」，重新給他套上大分類的枷鎖。
                        const fallbackMainCat = rawMainCats.find(c => c.name === userMsgTrimmed);
                        
                        if (fallbackMainCat) {
                            // 他點的是某個大分類
                            exactMatchFilter = { type: 'main', id: fallbackMainCat.id };
                            contextSlots.current_main_cat_id = fallbackMainCat.id;
                            contextSlots.current_main_cat_name = fallbackMainCat.name;
                            console.log(`📍 [漏斗強制帶位] 點擊大分類: ${userMsgTrimmed}，重新鎖定實體濾網！`);
                        } else if (contextSlots.current_sub_cat_id) {
                            exactMatchFilter = { type: 'sub', main_id: contextSlots.current_main_cat_id, sub_id: contextSlots.current_sub_cat_id };
                            console.log(`📍 [漏斗繼承] 點擊標籤: ${userMsgTrimmed}，繼承實體濾網: ${contextSlots.current_sub_cat_name}`);
                        } else if (contextSlots.current_main_cat_id) {
                            exactMatchFilter = { type: 'main', id: contextSlots.current_main_cat_id };
                            console.log(`📍 [漏斗繼承] 點擊標籤: ${userMsgTrimmed}，繼承實體濾網: ${contextSlots.current_main_cat_name}`);
                        } else {
                            // 🛑 [總監決策：漏斗防偏離機制] 
                            // 點擊了舊標籤，但沒有任何空間記憶！與其讓 RAG 全館瞎找，不如強制拉回大門口！
                            console.log(`📍 [漏斗防偏離] 點擊無效標籤: ${userMsgTrimmed}，強制重啟漏斗。`);
                            
                            contextSlots = {}; // 腦袋瞬間洗白
                            exactMatchFilter = null;
                            
                            // 🪄 神奇魔法：將使用者的意圖強制竄改為「重新開始」
                            // 這樣往下走就會完美觸發 isResetRequest 短路防線，吐出大分類菜單！
                            userMsg = "重新開始"; 
                        }
                    } else {
                        // 🛑 [右派：斷捨離] 客人手動打字跳船，瞬間清空記憶！
                        console.log(`🚷 [記憶斷捨離] 偵測到手打跳船意圖 (${userMsgTrimmed})，清空漏斗狀態！`);
                        contextSlots = {}; // 腦袋瞬間洗白
                        exactMatchFilter = null;
                    }
                }
            }

            // 🌟 將記憶非同步寫入資料庫 (已修正重複呼叫的問題)
            db.collection('clients').doc(clientId).collection('members').doc(userId)
              .set({ context_slots: contextSlots }, { merge: true }).catch(()=>{});
            currentMemberData.context_slots = contextSlots; // 更新記憶體狀態

            // 🌟 3. 將攔截器掛載，準備送給 RAG 引擎
            routerResponse.exactMatchFilter = exactMatchFilter;

            // 🛑 [終極殺招：斷絕 AI 偷懶的後路]
            if (exactMatchFilter && exactMatchFilter.type === 'sub') {
                categoryContext = `=== 🗂️ 商店導航架構 ===\n[SYSTEM ALERT: TERMINAL NODE REACHED]\n客人已經位於最底層小分類「${contextSlots.current_sub_cat_name || "特定分類"}」。\n🚨 絕對禁令：無菜單可選，也【嚴禁你自己發明分類】！你必須且只能從下方商品資料的「純淨標籤」中，挑選出最能區分這些商品的【現有實體標籤】（必須一字不差，最多可列出 13 個選項），來生成 <FILTER> 按鈕！`;
                console.log(`🚷 [防偷懶機制] 已沒收菜單，強制 AI 轉向讀取商品標籤 (解鎖 13 顆上限)`);
            }

            // 4. [發動 RAG] 帶著分類攔截器與座標進入搜尋
            const ragResult = await ragEngine.executeRagSearch({ db, clientId, genAI, extractedKeywords, hasSales, currentMemberData, routerResponse, ledger });
            qaContext = ragResult.qaContext; 
            allProductsCache = ragResult.allProductsCache; 
            productsContext = ragResult.productsContext; 
            ledger = ragResult.updatedLedger;



            // ==========================================================
            // 🛑 [總監升級：SaaS 方案 A 漏斗收斂器] 100% 客戶標籤 + 5件強制開牌
            // ==========================================================
            if (isFunnelClick && !matchedMainCat && !matchedSubCat) {
                // 1. 取得客人點擊的純淨標籤
                const clickedTag = userMsgTrimmed.replace(/^#/, '').trim().toLowerCase(); 
                
                // 2. 🔪 方案 A 物理過濾：只掃描商品 desc 裡面的手打 #標籤 (無視名稱與鋼印)
                let optionAFiltered = allProductsCache.filter(p => {
                    const descTags = ((p.desc || "") + " " + (p.description || "")).match(/#\S+/g) || [];
                    return descTags.join(" ").toLowerCase().includes(clickedTag);
                });

                // 3. 🎯 終極曝光與防呆防線：強制截斷到 5 件
                if (optionAFiltered.length > 0) {
                    // 完美命中客戶標籤：保留分數最高的前 5 件 (極限曝光)
                    allProductsCache = optionAFiltered.slice(0, 5); 
                    console.log(`🔪 [漏斗強制收斂] 命中標籤: ${clickedTag} | 物理壓縮至 ${allProductsCache.length} 件`);
                } else {
                    // AI 幻覺發作 (找不到標籤)：強制從 RAG 結果切前 5 件結案，絕不退回 15 件！
                    allProductsCache = allProductsCache.slice(0, 5); 
                    console.log(`⚠️ [AI 幻覺攔截] 找不到標籤: ${clickedTag}。強制截斷以完成漏斗閉環 -> ${allProductsCache.length} 件`);
                }

                // 4. 🧠 覆寫大腦視野，下達軍事指令逼迫出圖卡
                productsContext = allProductsCache.map(p => `[ID:${p.id}] ${p.name} - ${p.price || '價格未定'}`).join("\n\n");
                qaContext += `\n\n[🚨 SYSTEM OVERRIDE 絕對指令 🚨] 漏斗已收斂至 ${allProductsCache.length} 件 (小於等於 5 件)。你【必須立即】觸發圖卡展示規則！請直接介紹這些商品並加上 \`[SHOW:商品完整名稱]\` 指令！【嚴禁】繼續提問或產生 <FILTER> 按鈕！`;
            }
            // ==========================================================
            
        } else if (intentResult === "LOCATION" && hasO2O) {
            // O2O 門市記憶注入
            const stores = clientData.builder_settings?.stores || [];
            if (stores.length > 0) {
                const storeContext = maps.generateSystemPrompt(stores);
                qaContext += `\n\n=== 實體門市清單 (O2O) ===\n${storeContext}\n`;
                qaContext += `\n📍 [O2O 門市導航鐵律]：\n1. 若詢問特定門市，務必加入指令 \`[MAP:門市名稱]\`。\n2. 若詢問最近門市，嚴禁輸出 [MAP]，請回覆：「請點擊下方的『📍 分享位置』按鈕，讓我為您精準導航！」並在句尾加上 \`[REQUEST_LOCATION]\`。`;
            } else { 
                qaContext += `\n\n系統目前尚未設定實體門市，請委婉告知顧客。`; 
            }
        }


        // ==========================================================
        // 🌟 [新增模組] 歷史足跡無痕推薦 (Cross-Selling)
        // ==========================================================
        if (intentResult === "PRODUCT" && allProductsCache && allProductsCache.length > 0 && allProductsCache.length <= 5) {
            try {
                const funnelState = currentMemberData?.funnel_state || {};
                const currentProductNames = allProductsCache.map(p => p.name);
                
                // 取出歷史紀錄並過濾掉當前準備要發的商品
                let historyItems = Object.keys(funnelState).map(key => funnelState[key]);
                let validHistory = historyItems.filter(item => 
                    item.name && 
                    item.last_impression_at && 
                    item.type === 'PRODUCT' && // 🌟 嚴格限定：只能推薦「商品」，徹底封殺地圖老街！
                    !currentProductNames.includes(item.name)
                );
                
                // 依時間排序並抓取最高分商品
                validHistory.sort((a, b) => b.last_impression_at - a.last_impression_at);
                
                if (validHistory.length > 0) {
                    const topRecommendedProduct = validHistory[0].name;
                    qaContext += `\n\n[🚨 系統強制隱藏任務 - Cross-Selling]\n系統偵測到顧客先前曾對「${topRecommendedProduct}」有高度興趣。請在您原本回覆的最後一段，用極度自然順帶一提的口吻推薦這個商品。並且【強制】在句尾加上隱藏指令 \`[SHOW:${topRecommendedProduct}]\`。`;
                }
            } catch (err) { 
                console.warn(`⚠️ [Cross-Selling] 異常跳過:`, err.message); 
            }
        }


        // ==========================================================
        // 🛡️ [重選短路防線] 100% 確保重選時只出按鈕，不浪費 AI 算力
        // ==========================================================
        const isResetRequest = /從最開始|回選單|重新開始|重選|重新推薦/i.test(userMsg);
        let forceResetReply = null;

        if (isResetRequest && categoryContext) {
            // 嘗試從菜單中提取大分類陣列
            const mainCatMatch = categoryContext.match(/\[第一層根目錄 \(RESET_OPTIONS\)\]:\s*(\[.*?\])/);
            if (mainCatMatch) {
                // 將完美的按鈕陣列直接包裝進 <FILTER> 標籤，讓下方的解析器統一處理
                forceResetReply = `沒問題！這是我們目前的完整分類，請您先挑選感興趣的類別：\n<FILTER>${mainCatMatch[1]}</FILTER>`;
                console.log(`⚡ [Short-Circuit] 偵測到重選請求，強制中斷 AI`);
            }
        }


        // ==========================================================
        // 🎯 大腦生成回覆 (結合短路邏輯)
        // ==========================================================
        let replyText = "";
        let chatModelUsed = "skipped";

        if (!forceResetReply) {
            // 正常呼叫 AI 組裝與生成
            const finalPrompt = promptEngine.assemble(
                intentResult, 
                userMsg, 
                clientData.systemPrompt || "You are a sales consultant.", 
                gle.getInstruction(clientData.builder_settings?.gleSelectedLanguages || []), 
                qaContext, 
                productsContext, 
                JSON.stringify(currentMemberData.context_slots || {}), 
                categoryContext,
                { enableLeadCapture: hasService }
            );
            
            const generation = await generateWithFallback(genAI, finalPrompt);
            const chatResult = generation.result;
            chatModelUsed = generation.modelUsed;
            
            ledger.tokens += (chatResult.response.usageMetadata?.totalTokenCount || 0); 
            ledger.ai_model = `Router: ${routerModel} | Chat: ${chatModelUsed}`;
            replyText = chatResult.response.text();
            
            console.log(`🔍 [Token Audit] Total: ${ledger.tokens} | Chat: ${chatResult.response.usageMetadata?.totalTokenCount || 0}`);
        } else {
            // 觸發物理短路，零延遲零花費
            replyText = forceResetReply;
            ledger.ai_model = `Router: ${routerModel} | Chat: Short-Circuit (Reset)`;
        }


        // 準備 LINE 訊息結構
        const lineMessages = [];
        const trackingInfo = { cid: clientId, uid: userId, tid: traceId }; 
        let hasShownProducts = false;

        // 🛍️ [收斂漏斗雷達] 檢查目前的目標商品與數量
        let targetProductData = null; 
        let isMultiProduct = false; 
        
        if (allProductsCache && allProductsCache.length > 0) {
            targetProductData = allProductsCache[0];
            if (allProductsCache.length > 1) {
                isMultiProduct = true;
            }
        }
        
        const willShowFlexCard = /\[SHOW:.*?\]/i.test(replyText);
        const brandVibe = clientData.builder_settings?.brandVibe || 'Default';
        const funnelResult = salesfunnel.decorateMessage(replyText, targetProductData, brandVibe, intentResult, willShowFlexCard, isMultiProduct);
        replyText = funnelResult.cleanText;


        // ==========================================================
        // 🔍 [終極加強版] 攔截 <FILTER> 標籤 (支援 JSON 與 換行/逗號格式)
        // ==========================================================
        const filterRegex = /<FILTER>([\s\S]*?)<\/FILTER>/gi; 
        let filterOptions = [];
        let filterMatch;

        while ((filterMatch = filterRegex.exec(replyText)) !== null) {
            let rawContent = filterMatch[1].trim();
            try {
                // 1. 優先嘗試標準 JSON 解析
                const parsed = JSON.parse(rawContent);
                if (Array.isArray(parsed)) {
                    filterOptions = filterOptions.concat(parsed.map(String));
                } else {
                    filterOptions.push(String(parsed));
                }
            } catch (e) {
                // 2. [容錯降級] 使用正則切割換行、逗號，並過濾掉太長或太短的廢話
                const lines = rawContent.split(/\n|,|，/).map(s => s.trim()).filter(s => s.length > 0 && s.length <= 20);
                filterOptions = filterOptions.concat(lines);
            }
        }
        
        // 清洗回覆文字，移除標籤
        replyText = replyText.replace(filterRegex, '').trim();
        
        // 去重並截斷 (LINE 上限 13 個)
        filterOptions = [...new Set(filterOptions)].slice(0, 13);
        
        if (filterOptions.length > 0) {
             // 鐵律：如果觸發 FILTER，沒收所有 SHOW 指令
             replyText = replyText.replace(/\[SHOW:.*?\]/gi, '').trim();
        }
        // ==========================================================


        // 🔍 解析意圖 Slot 指令
        const slotRegex = /\[SLOTS:\s*(\{[\s\S]*?\})\s*\]/gi; 
        let slotMatch;
        while ((slotMatch = slotRegex.exec(replyText)) !== null) { 
            try { 
                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({ 
                    context_slots: JSON.parse(slotMatch[1]) 
                }, { merge: true }); 
            } catch (e) {} 
        }
        replyText = replyText.replace(slotRegex, '').trim();

        // 🌟 處理 AI 萃取到的名單 (LEAD) — 須啟用「真人商機」
        const leadRegex = /\[\s*LEAD\s*:\s*(.*?)\s*\]/gi; 
        if (hasService) {
            let leadMatch; 
            while ((leadMatch = leadRegex.exec(replyText)) !== null) {
                const cardMsg = await leads.processAiExtractedLead({ 
                    db, clientId, userId, leadContent: leadMatch[1], 
                    userMsg, lineDisplayName, linePictureUrl, clientDoc 
                });
                if (cardMsg) lineMessages.push(cardMsg);
            }
        }
        replyText = replyText.replace(leadRegex, '').trim();

        // 🔍 解析 SHOW 商品指令
        const showRegex = /\[SHOW:(.*?)\]/gi; 
        const productNamesToShow = []; 
        let match;
        while ((match = showRegex.exec(replyText)) !== null) { 
            productNamesToShow.push(match[1]); 
            ledger.details = (ledger.details ? ledger.details + " | " : "") + "Prods"; 
        }
        replyText = replyText.replace(showRegex, '').trim();

        // 💡 [記憶鎖定] 發送商品卡前，鎖定第一個商品 ID 防止斷片
        if (productNamesToShow.length > 0 && allProductsCache && allProductsCache.length > 0) {
            try { 
                const topProduct = allProductsCache[0];
                
                // 1. 更新短記憶 (Context Slots)
                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({ 
                    context_slots: { 
                        last_viewed_product_id: topProduct.id, 
                        last_viewed_product_name: topProduct.name 
                    } 
                }, { merge: true }); 

                // ==========================================================
                // 🌟 [總監修復：N+1 推薦池活水] 將商品曝光寫入長期漏斗記憶
                // ==========================================================
                await updateFunnelImpression(
                    clientDoc.ref, 
                    userId, 
                    topProduct.id || topProduct.name, // docId
                    topProduct.name,                  // itemName
                    'PRODUCT'                         // type (精準標記為商品)
                );
                
            } catch (e) {}
        }

        // 🔍 解析 MAP 地圖指令
        const mapRegex = /\[MAP:(.*?)\]/gi; 
        const mapNamesToShow = []; 
        let mapMatch;
        while ((mapMatch = mapRegex.exec(replyText)) !== null) { 
            mapNamesToShow.push(mapMatch[1].split('|')[0].trim()); 
            ledger.details = (ledger.details ? ledger.details + " | " : "") + "Maps"; 
        }
        replyText = replyText.replace(mapRegex, '').trim(); 

        // 🌟 攔截請求定位指令
        let isRequestingLocation = false;
        if (/\[REQUEST_LOCATION\]/i.test(replyText)) {
            isRequestingLocation = true; 
            replyText = replyText.replace(/\[REQUEST_LOCATION\]/gi, '').trim();
        }

        // 寫入對話紀錄並將主文字推入訊息陣列
        await saveChatHistory(clientDoc.ref, userId, historyUserMsg, replyText);
        if (replyText) {
            lineMessages.push({ type: 'text', text: replyText });
        }

        // 📍 地圖字卡渲染
        if (mapNamesToShow.length > 0 && hasO2O) {
            for (const mName of mapNamesToShow) {
                const storeData = maps.getStoreByName(mName, clientData.builder_settings?.stores || []);
                if (storeData) {
                    try { 
                        const mapFlex = await lineUI.createMapFlex([{ 
                            name: storeData.name, 
                            addressText: storeData.displayAddr || storeData.address, 
                            mapUrl: storeData.mapLink 
                        }], trackingInfo); 
                        if (mapFlex) lineMessages.push(mapFlex); 
                    } catch (e) {}
                }
            }
        }

        // 📦 商品字卡渲染 (總監升級：實名優先 + 模糊降級)
        if (productNamesToShow.length > 0 && allProductsCache.length > 0 && hasSales) {
            const processedProducts = allProductsCache.map(p => { 
                return { ...p, tags: ((p.desc || p.description || "").match(/#\S+/g) || []).join(" ") }; 
            });
            
            const fuse = new Fuse(processedProducts, { 
                includeScore: true, threshold: 0.6, distance: 200, // 稍微放寬模糊度
                keys: [{ name: 'tags', weight: 0.6 }, { name: 'name', weight: 0.4 }] 
            });
            
            const productsForFlex = []; 
            productNamesToShow.forEach(showName => { 
                // 🌟 寫一個脫殼小工具：清掉所有空格、括號、加號、錢號，並轉小寫
                const normalize = (str) => (str || "").replace(/[\s\(\)（）\+\-\$]/g, '').toLowerCase();

                // 🌟 第一重：實名制「脫殼」絕對匹配 (無視符號與全半形差異)
                const exactMatch = processedProducts.find(p => normalize(p.name) === normalize(showName));
                if (exactMatch) {
                    productsForFlex.push(exactMatch);
                } else {
                    // 🌟 第二重：才交給 Fuse.js 處理標籤或模糊名稱
                    const result = fuse.search(showName); 
                    if (result.length > 0) productsForFlex.push(result[0].item); 
                }
            });
            
            const uniqueProducts = [...new Set(productsForFlex)].slice(0, 10);
            if(uniqueProducts.length > 0) {
                const prodFlex = await lineUI.createProductFlex(
                    uniqueProducts, 
                    productNamesToShow, 
                    trackingInfo, 
                    clientData.builder_settings?.enable_immersive_showroom === true
                );
                if(prodFlex) { 
                    lineMessages.push(prodFlex); 
                    hasShownProducts = true; 
                }
            }
        }

        // 防呆：如果完全沒有訊息可送
        if (lineMessages.length === 0) {
            lineMessages.push({ type: 'text', text: "好的，系統正在為您確認中。" });
        }

        // 🛍️ 動態逼單與導航 Quick Reply 決定邏輯 (SaaS 淨化版)
        if (lineMessages.length > 0) {
            
            // ==========================================================
            // 🛑 [總監升級：展示間物理隔離] 
            // 只有在「不是」專屬動作 (如展示間) 的情況下，才允許塞入後續 QR
            // ==========================================================
            if (!isExclusiveAction) {
                if (isRequestingLocation) {
                    // 👑 絕對優先：LINE 內建定位按鈕
                    lineMessages[lineMessages.length - 1].quickReply = { 
                        items: [ { type: "action", action: { type: "location", label: "📍 分享我的位置" } } ] 
                    };
                } else if (filterOptions.length > 0) {
                    // 🥇 漏斗收斂：使用 FILTER 收斂按鈕 (轉為 Postback 隱藏傳值機制)
                    const filterQRs = filterOptions.map(opt => ({ 
                        type: "action", 
                        action: { 
                            type: "postback", 
                            label: opt.substring(0, 20), 
                            data: `action=filter_click&value=${encodeURIComponent(opt)}`,
                            displayText: opt // 💡 神奇魔法：UX 零違和，同時通知系統這是一次實體點擊
                        } 
                    }));
                    
                    // 🌟 [新增 UX 視覺引導] 在最後一句話補上 CTA，強力防堵「手打強迫症」
                    const lastMsgIndex = lineMessages.length - 1;
                    lineMessages[lastMsgIndex].text += "\n\n👇 請直接點擊下方的專屬選項，讓我為您精準推薦：";

                    lineMessages[lastMsgIndex].quickReply = { items: filterQRs };
                } else {
                    // 🥉 保底預設：店家後台設定的 QR (已物理超渡 AI 亂生成的逼單按鈕 🪦)
                    // 只有在沒有標籤可選、沒有定位請求時，才端出大廳菜單給客人退路
                    const qrData = await leads.getLeadQuickReply(clientData, currentMemberData, hasShownProducts);
                    if (qrData) {
                        lineMessages[lineMessages.length - 1].quickReply = qrData;
                    }
                }
            } else {
                console.log("🛡️ [防護網作動] 本回合為展示間專屬動作，已攔截並封印所有預設 QR！");
            }
        }

        // 執行 LINE API 推播
        await axios.post('https://api.line.me/v2/bot/message/reply', { 
            replyToken, 
            messages: lineMessages 
        }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });

    } catch (error) {
        console.error(`💥 [${SYSTEM_VERSION}] ERROR:`, error.message);
    } finally {
        // 確保計費模組正確執行
        if(clientId) {
            await billing.performBillingAndLogging(db, clientId, lineDisplayName, historyUserMsg, ledger, SYSTEM_VERSION);
        }
        if (!res.headersSent) res.status(200).send("OK");
    }
});