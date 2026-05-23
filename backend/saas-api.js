/**
 * ============================================================================
 * 系統核心 API 網關 (SaaS API Gateway)
 * 檔案名稱: saas-api.js
 * 系統版本: v24.2.2 (全域模型控管升級版)
 * * [功能模組清單]
 * 1. synthesisTask : AI 沉浸展示間 (VTO/Scene Gen) 圖像合成與 LINE 推播。
 * 2. submitForm    : SaaS 官網新客建置表單接收與 Telegram 即時通報。
 * 3. aiTagSuggest  : 商家上架商品時的 AI 視覺辨識、自動標籤與路由判定。
 * 4. getEmbedding  : 將文字轉換為 768 維度的向量特徵 (用於 RAG 檢索)。
 * ============================================================================
 */

const admin = require("firebase-admin");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const sharp = require("sharp");
const synthesisEngine = require("./synthesis-engine");
const { validateUserPhoto } = require("./aidp-logic");
const billing = require("./billing");

// 🌟 [升級] 引入全域 AI 模型設定檔
const { MODEL_PRIMARY, MODEL_IMAGE, MODEL_EMBEDDING } = require('./ai-config');

async function handleApiRequests(req, res, db, SYSTEM_VERSION) {
    
    // ============================================================================
    // 🚀 [API 1] 沉浸展示間合成任務 (Synthesis Task)
    // 流程：取得圖片 -> 魔法師審查 (AIDP) -> AI 圖像合成 -> 上傳雲端 -> LINE 推播
    // ============================================================================
    if (req.query.action === 'synthesisTask') {
        const { userId, clientId, baseImageId, targetProductId, targetIntent } = req.body;
        if (!userId || !clientId || !baseImageId || !targetProductId || !targetIntent) {
            return res.status(400).send("Bad Request");
        }

        const traceId = `task-${Date.now()}`;
        // 💰 初始化計費帳本 (預設先收 2 次 DB 讀取費，ai_model 改用全域變數)
        let ledger = { traceId, reads: 2, tokens: 0, action: "AI_SHOWROOM_SYNTHESIS", status: "SUCCESS", details: `Intent: ${targetIntent}`, ai_model: MODEL_IMAGE, hasTgSummary: false };

        try {
            // 1. 取得客戶設定與機密金鑰 (Secret Vault)
            const clientDoc = await db.collection('clients').doc(clientId).get();
            const clientData = clientDoc.data();
            const secretSnap = await db.collection('clients').doc(clientId).collection('secrets').doc('keys').get();
            const s = secretSnap.data();
            
            if (!s || !s.channelAccessToken || !s.geminiApiKey) throw new Error("Missing Keys");

            let contextImagePart = null;
            let contextBase64 = null;

            // 2. 處理基底圖片 (空白背景 / 保留背景 / 下載使用者傳送的照片)
            if (baseImageId === "SCENE_GEN_WHITE") {
                const blankBuffer = await sharp({
                    create: { width: 512, height: 512, channels: 3, background: { r: 245, g: 245, b: 245 } }
                }).jpeg().toBuffer();
                contextBase64 = blankBuffer.toString('base64');
                contextImagePart = { inlineData: { data: contextBase64, mimeType: "image/jpeg" } };
            } else if (baseImageId === "SCENE_GEN_CONTEXT") {
                contextImagePart = null;
            } else {
                const lineImageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${baseImageId}/content`, {
                    headers: { 'Authorization': `Bearer ${s.channelAccessToken}` },
                    responseType: 'arraybuffer'
                });
                // 壓縮圖片以節省記憶體與傳輸時間
                const compressedContextBuffer = await sharp(lineImageRes.data).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
                contextBase64 = compressedContextBuffer.toString('base64');
                contextImagePart = { inlineData: { data: contextBase64, mimeType: "image/jpeg" } };
            }

            // 3. 獲取目標商品圖片 URL
            const targetProdDoc = await db.collection('clients').doc(clientId).collection('products').doc(targetProductId).get();
            ledger.reads += 1;
            
            if (!targetProdDoc.exists) throw new Error("Product Not Found");
            const targetProductData = targetProdDoc.data();
            const safeImgUrl = targetProductData.imageUrl || targetProductData.image || targetProductData.imgUrl || targetProductData.image_url;
            if (!safeImgUrl) throw new Error("No Valid Image URL");

            // 4. AIDP 防護邏輯 (審查使用者上傳的照片是否合規)
            let validateResult;
            if (baseImageId.startsWith("SCENE_GEN")) {
                validateResult = { success: true, data: { status: 'PASS', dynamic_prompt: targetIntent }, tokens: 0 };
            } else {
                validateResult = await validateUserPhoto(s.geminiApiKey, MODEL_PRIMARY, targetIntent, contextBase64);
                ledger.tokens += (validateResult.tokens || 0); // 💰 記錄審查消耗的 Token
            }

            // 若審查未通過，發送 LINE 拒絕訊息並退回狀態
            if (validateResult.success && validateResult.data.status === 'REJECT') {
                await axios.post('https://api.line.me/v2/bot/message/push', {
                    to: userId,
                    messages: [{ type: 'text', text: `⚠️ ${validateResult.data.reject_reason}\n\n👉 請您根據提示重新傳送一張照片，魔法師隨時準備為您合成喔！\n(若想取消，請直接點選選單其他商品即可)` }]
                }, { headers: { 'Authorization': `Bearer ${s.channelAccessToken}` } });
                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({ showroom_state: 'WAITING_IMAGE' }, { merge: true });
                ledger.status = "REJECTED";
                ledger.action = "AI_SHOWROOM_REJECTED";
                await billing.performBillingAndLogging(db, clientId, userId, "【照片審查未通過】", ledger, SYSTEM_VERSION);
                return res.status(200).send("Task Rejected by AIDP");
            }

            // 5. 呼叫圖像合成引擎
            const dynamicPrompt = (validateResult.success && validateResult.data.dynamic_prompt) ? validateResult.data.dynamic_prompt : targetIntent;
            const synthResult = await synthesisEngine.generateShowroomImage(s.geminiApiKey, contextImagePart, safeImgUrl, dynamicPrompt, clientData, targetProductData.name);
            
            if (synthResult.status === "success") {
                ledger.tokens += (synthResult.tokens || 0); // 💰 記錄繪圖消耗的 Token
                
                // 6. 將合成結果上傳至 Firebase Cloud Storage
                const bucket = admin.storage().bucket('lllcnd.firebasestorage.app');
                const fileName = `showroom/${clientId}/${userId}_${Date.now()}.jpg`;
                const file = bucket.file(fileName);
                await file.save(Buffer.from(synthResult.base64, 'base64'), { metadata: { contentType: 'image/jpeg' }, public: true });
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

                // ============================================================
                // 👑 7. 組合全自動引流按鈕 (極簡導購版：移除斷層按鈕)
                // ============================================================
                const builderSettings = clientData.builder_settings || {};
                const customReplies = builderSettings.quickReplies || [];

                // 直接將後台設定的「引流神器」作為按鈕來源，不再強插系統功能按鈕
                const finalItems = customReplies.slice(0, 13).map(qr => {
                    if (qr.label && qr.text) {
                        return { 
                            type: "action", 
                            action: { type: "message", label: qr.label.substring(0, 20), text: qr.text } 
                        };
                    }
                    return null;
                }).filter(Boolean);

                // 8. 發送圖片 + 帶有 Quick Reply 的文字訊息
                await axios.post('https://api.line.me/v2/bot/message/push', {
                    to: userId,
                    messages: [
                        { type: "image", originalContentUrl: publicUrl, previewImageUrl: publicUrl },
                        { 
                            type: "text", 
                            text: `✨ 登登！這是為您專屬合成的展示效果！\n您覺得這款【${targetProductData.name}】搭配起來好看嗎？`,
                            quickReply: { items: finalItems }
                        }
                    ]
                }, { headers: { 'Authorization': `Bearer ${s.channelAccessToken}` } });

                const twDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().split('T')[0];
                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
                    showroom_state: 'IDLE', showroom_target_product_id: null, showroom_selected_intent: null, showroom_last_date: twDate, showroom_daily_count: admin.firestore.FieldValue.increment(1)
                }, { merge: true });

                await billing.performBillingAndLogging(db, clientId, userId, `【沉浸展示間合成】商品：${targetProductData.name}`, ledger, SYSTEM_VERSION);
            } else {
                throw new Error(synthResult.message);
            }
        } catch (error) {
            console.error("Worker Error:", error.message);
            ledger.action = "SYSTEM_ERROR";
            try {
                await billing.performBillingAndLogging(db, clientId, userId, "【合成失敗】", ledger, SYSTEM_VERSION);
                await db.collection('clients').doc(clientId).collection('members').doc(userId).set({ showroom_state: 'IDLE', showroom_target_product_id: null, showroom_selected_intent: null }, { merge: true });
            } catch(e) { console.error("Final catch error", e); }
        }
        return res.status(200).send("Task Completed");
    }

    // ============================================================================
    // 🚀 [API 2] 官網表單提交 (Submit Form)
    // ============================================================================
    if (req.query.action === 'submitForm') {
        try {
            const data = req.body;
            const uid = data.userId;
            if (!data.name || !data.phone || !uid || uid === "無授權") {
                return res.status(400).json({ status: "error", message: "請填寫必要資訊並完成 LINE 授權。" });
            }
            await db.collection('applications').doc(uid).set({
                name: data.name || "未填寫", phone: data.phone || "未填寫", email: data.email || "未填寫",
                industry: data.industry || "未填寫", serviceType: data.serviceType || "未填寫", memo: data.memo || "",
                lineUserId: uid, submitAt: admin.firestore.FieldValue.serverTimestamp(), status: 'new'
            }, { merge: true });

            const botToken = "8553358478:AAGOELnXfReWIRwTRtMSz6r0PepoDGZhv0A";
            const chatId = "8549380045";
            let paymentStatus = data.serviceType.includes('5,000') ? '⏳ 待付款 (已引導至綠界)' : '📝 待聯繫 (企業採購)';
            const telegramMsg = `🚀 [品智 SaaS 新客申請]\n\n👤 姓名/品牌: ${data.name}\n📱 電話: ${data.phone}\n📧 Email: ${data.email}\n🏢 產業: ${data.industry}\n💼 方案: ${data.serviceType}\n💳 狀態: ${paymentStatus}\n📝 備註: ${data.memo || '無'}\n🔗 UID: ${uid}`;
            
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text: telegramMsg });
            return res.status(200).json({ status: "success", message: "✅ 申請成功！系統工程師將盡快與您聯繫。" });
        } catch (error) {
            return res.status(500).json({ status: "error", message: "連線異常，請稍後再試。" });
        }
    }

    // ============================================================================
    // 🚀 [API 3] AI 視覺自動標籤與路由建議 (AI Tag Suggest)
    // ============================================================================
    if (req.query.action === 'aiTagSuggest') {
        let ledger = { traceId: `tag-${Date.now()}`, reads: 1, tokens: 0, action: "AI_VISION_AUDIT", status: "SUCCESS", details: "AI_Vision_Audit_Pass", ai_model: MODEL_PRIMARY, hasTgSummary: false };
        try {
            const data = req.body;
            const cid = data.clientId;
            const imgUrl = data.imageUrl;
            if (!cid || !imgUrl) return res.status(400).json({ status: "error", message: "缺少必要參數" });

            const clientRef = db.collection('clients').doc(cid);
            const clientDoc = await clientRef.get();
            if (!clientDoc.exists) return res.status(403).json({ status: "error", message: "找不到店家" });
            const clientData = clientDoc.data();
            
            try {
                const secretSnap = await clientRef.collection('secrets').doc('keys').get();
                if (!secretSnap.exists || !secretSnap.data().geminiApiKey) return res.status(403).json({ status: "error", message: "機密金庫缺少 AI 金鑰" });
                clientData.geminiApiKey = secretSnap.data().geminiApiKey;
            } catch(vErr) { return res.status(500).json({ status: "error", message: "金庫連線異常" }); }

            if ((clientData.balance_points || 0) < 150) return res.status(403).json({ status: "error", message: "算力點數不足" });

            const imgResp = await axios.get(imgUrl, { responseType: 'arraybuffer' });
            const base64Data = Buffer.from(imgResp.data, 'binary').toString('base64');

            const genAI = new GoogleGenerativeAI(clientData.geminiApiKey);
            // 🌟 讀取全域主要模型
            const model = genAI.getGenerativeModel({ model: MODEL_PRIMARY, generationConfig: { responseMimeType: "application/json" } });
            
            const prompt = `
            [SYSTEM ROLE: SAAS PRODUCT AUDITOR]
            You are a strict e-commerce product classifier and safety auditor. 
            Analyze the provided image and return a JSON object with exactly two keys: "tags" and "system_route".

            1. "tags": An array of 5 highly relevant marketing keywords in Traditional Chinese (e.g., ["#婚紗", "#蕾絲", "#長裙", "#優雅", "#婚禮"]). Do NOT include the '#' symbol in the array strings.
            2. "system_route": You MUST assign exactly ONE of the following routing codes based on the image content:
            - "SCENE_GEN": IF the image contains explicitly private wearables (lingerie, underwear, swimwear).
            - "VTO_PERSON": IF the image is normal outerwear strictly worn on the body (e.g., shirts, jackets, dresses, pants).
            - "VTO_SPACE": IF the item is large furniture (sofas, beds, dining tables).
            - "HYBRID_INTERACTION": IF the item has a dual-nature where it can be HELD/USED by a human OR PLACED on a surface (e.g., plush toys, mugs, tumblers, perfumes, bags, action figures, small gadgets).
            - "STATIC": IF the item is purely placed on a surface and rarely held for lifestyle photos (e.g., hardware tools, packaged food, large appliances).

            Output ONLY valid JSON.
            `;
            const aiResult = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType: imgResp.headers['content-type'] } }]);
            
            if (aiResult.response.usageMetadata) ledger.tokens += (aiResult.response.usageMetadata.totalTokenCount || 0);

            let auditResult;
            try { auditResult = JSON.parse(aiResult.response.text().trim()); } 
            catch (e) { auditResult = { tags: ["AI解析異常"], system_route: "VTO_PERSON" }; }

            const cleanTags = (auditResult.tags || []).map(t => t.trim().replace(/#/g, '')).filter(t => t.length > 0);
            const finalRoute = auditResult.system_route || "VTO_PERSON";

            await billing.performBillingAndLogging(db, cid, "SaaS_Admin", `[視覺標籤] ${cleanTags.join(', ')} | 路由：${finalRoute}`, ledger, SYSTEM_VERSION);
            return res.status(200).json({ status: "success", tags: cleanTags, system_route: finalRoute });

        } catch (error) {
            ledger.status = "ERROR"; ledger.details = error.message;
            if (req.body.clientId) await billing.performBillingAndLogging(db, req.body.clientId, "SaaS_Admin", "圖片解析失敗", ledger, SYSTEM_VERSION);
            return res.status(500).json({ status: "error", message: "圖片解析失敗。" });
        }
    }

    // ============================================================================
    // 🚀 [API 4] 向量特徵轉換 (Get Embedding)
    // ============================================================================
    if (req.query.action === 'getEmbedding') {
        try {
            const { clientId, text } = req.body;
            if (!clientId || !text) return res.status(400).json({ status: "error", message: "缺少必要參數" });
            const cleanText = text.trim();
            if (cleanText.length === 0) return res.status(200).json({ status: "success", embedding: null });

            const secretSnap = await db.collection('clients').doc(clientId).collection('secrets').doc('keys').get();
            if (!secretSnap.exists || !secretSnap.data().geminiApiKey) return res.status(403).json({ status: "error", message: "缺少 AI 金鑰" });

            const genAI = new GoogleGenerativeAI(secretSnap.data().geminiApiKey);
            // 🌟 改用全域向量模型變數
            const model = genAI.getGenerativeModel({ model: MODEL_EMBEDDING });
            const result = await model.embedContent(cleanText);
            
            return res.status(200).json({ status: "success", embedding: result.embedding.values.slice(0, 768) });
        } catch (error) {
            return res.status(500).json({ status: "error", message: `API 異常: ${error.message}` });
        }
    }
    
    return res.status(404).send("API Action Not Found");
}

module.exports = { handleApiRequests };