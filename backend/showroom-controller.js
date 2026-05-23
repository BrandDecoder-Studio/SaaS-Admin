/**
 * 🛠️ 沉浸展示間狀態機 (showroom-controller.js)
 * 負責處理：Postback 啟動、情境選擇、照片接收與 Cloud Tasks 派發
 * 🌟 [Update] 全域對接 ai-config 模型控管
 * 🌟 [Update] 支援傳遞浮水印算力加收費率參數
 * 🌟 [Update] 捷徑記憶強植：點擊展示立即鎖定大腦記憶，解決斷片問題！
 */
const admin = require("firebase-admin");
const axios = require("axios");
const { analyzeProduct } = require("./aidp-logic");
const billing = require("./billing");

// 🌟 引入全域 AI 模型設定檔
const { MODEL_PRIMARY } = require('./ai-config');

async function handleShowroom(params) {
    const {
        req, event, msgType, userMsg, replyToken, userId, clientId, 
        clientData, currentMemberData, db, tasksClient, 
        PROJECT_ID, REGION, ledger, SYSTEM_VERSION
    } = params;

    // ==========================================================
    // 🌟 1. 處理按鈕的 Postback 指令 (啟動展示間 & 大腦分析商品)
    // ==========================================================
    if (msgType === 'postback') {
        const postbackData = event.postback.data; 
        const urlParams = new URLSearchParams(postbackData);
        const action = urlParams.get('action');
        const targetProductId = urlParams.get('productId');

        if (action === 'start_showroom' && targetProductId) {
            console.log(`[Showroom] 客人點擊啟動按鈕，指定商品: ${targetProductId}`);
            const nonce = urlParams.get('nonce');
            
            // 🛡️ [防護網 A & B：一次性按鈕與防連點]
            const usedNonces = currentMemberData.used_nonces || [];
            if (nonce && usedNonces.includes(nonce)) {
                console.log(`🛡️ [安全攔截] 訪客 ${userId} 點擊了舊按鈕，無聲忽略。`);
                return { handled: true, ledger };
            }
            const now = Date.now();
            const lastClickTime = currentMemberData.last_showroom_click_at || 0;
            if (now - lastClickTime < 15000) {
                console.log(`🛡️ [防連點攔截] 訪客 ${userId} 點擊太快，保護算力。`);
                return { handled: true, ledger };
            }

            if (nonce) {
                usedNonces.push(nonce);
                if (usedNonces.length > 20) usedNonces.shift(); 
            }

            await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
                last_showroom_click_at: now,
                used_nonces: usedNonces
            }, { merge: true });

            // ⏳ 啟動 Loading 動畫
            try {
                await axios.post('https://api.line.me/v2/bot/chat/loading/start', {
                    chatId: userId, loadingSeconds: 25
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
            } catch (e) { console.warn("Loading 動畫啟動失敗", e.message); }

            try {
                const targetProdDoc = await db.collection('clients').doc(clientId).collection('products').doc(targetProductId).get();
                ledger.reads += 1;
                const prodData = targetProdDoc.data() || {};
                const productName = prodData.name || "該商品";
                const aiAuditData = prodData.ai_system_audit || null;

                // 🧠 呼叫 AIDP 大腦分析商品 (對接全域 MODEL_PRIMARY)
                const aidpResult = await analyzeProduct(clientData.geminiApiKey, MODEL_PRIMARY, productName, 'basic', aiAuditData);
                ledger.tokens += (aidpResult.tokens || 0); 

                if (aidpResult.success && aidpResult.data.top_scenarios) {
                    const scenarios = aidpResult.data.top_scenarios;
                    const interactionType = aidpResult.data.interaction_type; 
                    
                    // 🛑 【核心修復】在此處立刻將記憶寫入 context_slots，覆蓋掉舊有的商品記憶！
                    await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
                        showroom_state: 'WAITING_SCENARIO', 
                        showroom_target_product_id: targetProductId,
                        showroom_scenarios: scenarios,
                        showroom_interaction_type: interactionType,
                        // 🧠 [捷徑記憶強植]：只要點擊展示，立刻洗掉舊記憶，強制鎖定這件商品！
                        context_slots: {
                            last_viewed_product_id: targetProductId,
                            last_viewed_product_name: productName
                        }
                    }, { merge: true });

                    const quickReplyItems = scenarios.map(s => ({
                        type: 'action',
                        action: { type: 'message', label: s.label, text: `[展示選擇] ${s.label}` }
                    }));

                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ 
                            type: 'text', 
                            text: `✨ 沒問題！為您啟動【${productName}】專屬展示間。\n\n這款${aidpResult.data.category || '精選商品'}有兩種超好看的展示方式，請問您想看哪一種呢？👇`,
                            quickReply: { items: quickReplyItems }
                        }]
                    }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });

                    ledger.action = "AI_SHOWROOM_QUEUED_AIDP"; 
                    await billing.performBillingAndLogging(db, clientId, userId, `[沉浸展示間啟動] 分析商品: ${productName}`, ledger, SYSTEM_VERSION);
                    return { handled: true, ledger }; 
                }
            } catch (err) {
                console.error("[Showroom Postback Error]", err);
                return { handled: true, ledger: { ...ledger, status: "ERROR", details: err.message } };
            }
        }
        return { handled: true, ledger }; 
    }

    // ==========================================================
    // 🌟 2. 攔截步驟：客人點擊了 Quick Reply (選擇了情境)
    // ==========================================================
    if (msgType === 'text' && currentMemberData.showroom_state === 'WAITING_SCENARIO') {
        if (userMsg.startsWith('[展示選擇]')) {
            const selectedLabel = userMsg.replace('[展示選擇] ', '').trim();
            const scenarios = currentMemberData.showroom_scenarios || [];
            
            const intentIndex = scenarios.findIndex(s => s.label === selectedLabel);
            const matchedScenario = intentIndex !== -1 ? scenarios[intentIndex] : scenarios[0];
            const interactionType = currentMemberData.showroom_interaction_type; 

            // 🚀 核心防呆：判斷是否為「免傳圖捷徑」
            const isDirectGeneration = (interactionType === 'SCENE_GEN') || (interactionType === 'STATIC' && intentIndex === 1);

            if (isDirectGeneration) {
                const processingMsg = matchedScenario.photo_hint.includes('不需上傳照片') 
                    ? matchedScenario.photo_hint 
                    : "✨ 沒問題！本模式為保護隱私與呈現最高質感，不需上傳照片。AI 魔法師正在為您直接生成專屬美圖，預計需要 30 秒，請稍候 ☕";

                // 捷徑：直接發送至背景算圖
                await axios.post('https://api.line.me/v2/bot/message/reply', {
                    replyToken: replyToken,
                    messages: [{ type: 'text', text: processingMsg }] 
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });

                try {
                    await axios.post('https://api.line.me/v2/bot/chat/loading/start', {
                        chatId: userId, loadingSeconds: 30
                    }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
                } catch (e) { console.warn("Loading 動畫啟動失敗", e); }

                const baseImageId = (interactionType === 'SCENE_GEN' && intentIndex === 0) ? "SCENE_GEN_WHITE" : "SCENE_GEN_CONTEXT"; 

                const parent = tasksClient.queuePath(PROJECT_ID, REGION, "synth-queue");
                const workerUrl = `https://${req.hostname}${req.originalUrl.split("?")[0]}?action=synthesisTask`;
                const payload = {
                    userId, clientId, baseImageId, 
                    targetProductId: currentMemberData.showroom_target_product_id,
                    targetIntent: matchedScenario.intent 
                };

                await tasksClient.createTask({
                    parent, task: {
                        httpRequest: {
                            httpMethod: "POST", url: workerUrl,
                            headers: { "Content-Type": "application/json" },
                            body: Buffer.from(JSON.stringify(payload)).toString("base64"),
                        }
                    }
                });

                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
                    showroom_state: 'PROCESSING_STUDIO',
                    showroom_selected_intent: matchedScenario.intent
                }, { merge: true });

                ledger.action = "AI_SHOWROOM_STUDIO_QUEUED";
                await billing.performBillingAndLogging(db, clientId, userId, `[展示選擇] 免傳圖捷徑: ${selectedLabel}`, ledger, SYSTEM_VERSION);
                return { handled: true, ledger };
            } else {
                // 一般商品：要求上傳照片
                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
                    showroom_state: 'WAITING_IMAGE',
                    showroom_selected_intent: matchedScenario.intent
                }, { merge: true });

                await axios.post('https://api.line.me/v2/bot/message/reply', {
                    replyToken: replyToken,
                    messages: [{ type: 'text', text: matchedScenario.photo_hint }]
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });

                ledger.action = "AI_SHOWROOM_INTENT_SELECTED";
                await billing.performBillingAndLogging(db, clientId, userId, `[展示選擇] 要求傳圖: ${selectedLabel}`, ledger, SYSTEM_VERSION);
                return { handled: true, ledger };
            }
        }
    }

    // ==========================================================
    // 🌟 3. 攔截步驟：客人傳送照片 (拋給 Worker 處理)
    // ==========================================================
    if (msgType === 'image') {
        const messageId = event.message.id;
        if (currentMemberData.showroom_state === 'WAITING_IMAGE' && currentMemberData.showroom_target_product_id) {
            
            // 🛑 核心防護：立刻鎖定狀態為 PROCESSING_IMAGE
            await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
                showroom_state: 'PROCESSING_IMAGE'
            }, { merge: true });

            await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: [{ type: 'text', text: "✨ 收到素材！AI 攝影導演正在為您準備最高畫質的合成，預計需要 30 秒左右，請稍候 ☕" }]
            }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });

            try {
                await axios.post('https://api.line.me/v2/bot/chat/loading/start', {
                    chatId: userId, loadingSeconds: 45 
                }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
            } catch (loadErr) { console.warn("[LINE Loading API] 觸發失敗:", loadErr.message); }

            const parent = tasksClient.queuePath(PROJECT_ID, REGION, "synth-queue");
            const workerUrl = `https://${req.hostname}${req.originalUrl.split("?")[0]}?action=synthesisTask`;
            const payload = {
                userId, clientId, baseImageId: messageId, 
                targetProductId: currentMemberData.showroom_target_product_id,
                targetIntent: currentMemberData.showroom_selected_intent 
            };

            await tasksClient.createTask({
                parent, task: {
                    httpRequest: {
                        httpMethod: "POST", url: workerUrl,
                        headers: { "Content-Type": "application/json" },
                        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
                    }
                }
            });
            
            ledger.action = "AI_SHOWROOM_QUEUED_AIDP";
            await billing.performBillingAndLogging(db, clientId, userId, "[上傳照片] 進入算圖排程", ledger, SYSTEM_VERSION);
            return { handled: true, ledger }; 
        }
    }

    // 如果都不是展示間的事件，回傳 handled: false，讓 index.js 繼續往下走
    return { handled: false, ledger };
}

module.exports = { handleShowroom };