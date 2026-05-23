/**
 * js/leads.js
 * ------------------------------------------------
 * 商機獵人模組 (Lead Hunter Engine)
 * 負責：個資攔截 (Phone/Email)、TG 通報、AI 戰情摘要、15秒冷卻邏輯、引導字卡
 */

const axios = require("axios");
const admin = require("firebase-admin");
const { MODEL_PRIMARY, MODEL_FALLBACK } = require('./ai-config');

const REGEX_COLLECTOR = {
    phone: /(09\d{2}[-\s]?\d{3}[-\s]?\d{3})|(0[2-8][-\s]?\d{1,2}[-\s]?\d{4}(?:#\d+)?)/,
    email: /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/
};

// 內部輔助：標記漏斗已轉單
async function markFunnelAsLead(clientRef, userId) {
    try {
        const memberRef = clientRef.collection('members').doc(userId);
        const doc = await memberRef.get();
        if (doc.exists && doc.data().funnel_state) {
            const funnelState = doc.data().funnel_state;
            const updates = {};
            for (const topic in funnelState) {
                if (!funnelState[topic].lead_submitted) updates[`funnel_state.${topic}.lead_submitted`] = true;
            }
            if (Object.keys(updates).length > 0) await memberRef.update(updates);
        }
    } catch (e) {}
}

// 內部輔助：取得歷史對話字串 (TG 摘要用)
async function getHistoryForSummary(clientRef, userId) {
    try {
        const snap = await clientRef.collection('members').doc(userId)
            .collection('history').orderBy('timestamp', 'desc').limit(6).get();
        return snap.docs.map(d => `${d.data().role}: ${d.data().content || ""}`).reverse().join("\n");
    } catch (e) { return ""; }
}

// 🌟 核心功能 1：檢查並攔截商機
async function checkAndCapture({ db, userMsg, historyUserMsg, userId, lineDisplayName, linePictureUrl, clientId, clientData, clientDoc, replyToken, genAI, ledger, saveChatHistoryFn }) {
    const matchedPhone = userMsg.match(REGEX_COLLECTOR.phone);
    const matchedEmail = userMsg.match(REGEX_COLLECTOR.email);

    if (!matchedPhone && !matchedEmail) return { captured: false, ledger }; // 沒抓到個資，放行回主流程

    const contactDetail = (matchedPhone ? matchedPhone[0] : "") + (matchedPhone && matchedEmail ? " / " : "") + (matchedEmail ? matchedEmail[0] : "");
    let notifiedTg = false, aiSummarized = false, leadSummary = "";
    const builderSettings = clientData.builder_settings || {};
    const clientTgId = builderSettings.telegramChatId; 
    const enableSummary = builderSettings.enable_tg_summary; 

    if (clientTgId) {
        try {
            if (enableSummary && genAI) {
                const historyText = await getHistoryForSummary(clientDoc.ref, userId);
                const summaryPrompt = `請根據以下最近的對話紀錄，用15個字以內精準總結這名客戶的具體需求與預算。\n對話紀錄：\n${historyText}\n客戶最後一句話：${userMsg}`;
                
                let sumResult;
                try {
                    const model = genAI.getGenerativeModel({ model: MODEL_PRIMARY });
                    sumResult = await model.generateContent(summaryPrompt);
                } catch (e) {
                    const fallbackModel = genAI.getGenerativeModel({ model: MODEL_FALLBACK });
                    sumResult = await fallbackModel.generateContent(summaryPrompt);
                }
                
                leadSummary = sumResult.response.text().trim();
                aiSummarized = true;
                if (sumResult.response.usageMetadata) ledger.tokens += (sumResult.response.usageMetadata.totalTokenCount || 0);
                ledger.hasTgSummary = true; 
                ledger.details = (ledger.details ? ledger.details + " | " : "") + "TG_Summary_Generated";
            }
            const botToken = "8553358478:AAGOELnXfReWIRwTRtMSz6r0PepoDGZhv0A"; // ⚠️ 正式環境建議移至 Secret
            let leadMsg = `🎉 [品智 AI 商機進件]\n\n👤 潛在客: ${lineDisplayName}\n📞 聯絡資訊: ${contactDetail}\n💬 原始需求: ${userMsg}`;
            if (aiSummarized && leadSummary) leadMsg += `\n\n💡 [AI 戰情摘要]: ${leadSummary}`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: clientTgId, text: leadMsg });
            notifiedTg = true;
        } catch (tgErr) { console.error("商機通報店家失敗", tgErr.message); }
    }

    // 寫入資料庫
    await db.collection('clients').doc(clientId).collection('leads').add({
        userId, contactInfo: contactDetail, displayName: lineDisplayName, pictureUrl: linePictureUrl, 
        createdAt: admin.firestore.FieldValue.serverTimestamp(), status: 'new', source: 'line', 
        tg_notified: notifiedTg, ai_summarized: aiSummarized  
    });

    // 啟動 15 秒冷卻
    await db.collection('clients').doc(clientId).collection('members').doc(userId).set({
        lastLeadCaptureAt: admin.firestore.FieldValue.serverTimestamp(), lastMessageAt: admin.firestore.FieldValue.serverTimestamp(), consecutive_chat_count: 0 
    }, { merge: true });
    
    await markFunnelAsLead(clientDoc.ref, userId);

    const confirmMsg = "好的，我們已收到您的聯繫資訊，將會盡快安排專人與您聯繫。感謝您的耐心等候。";
    const quickReplyData = await getLeadQuickReply(clientData, {}, false);
    const textMsgObj = { type: 'text', text: confirmMsg };
    if (quickReplyData) textMsgObj.quickReply = quickReplyData;

    await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken: replyToken, messages: [getLeadConfirmedFlexMessage(lineDisplayName), textMsgObj]
    }, { headers: { 'Authorization': `Bearer ${clientData.channelAccessToken}` } });
    
    if (saveChatHistoryFn) await saveChatHistoryFn(clientDoc.ref, userId, historyUserMsg, confirmMsg); 
    
    ledger.action = "AI_LEAD_CAPTURE"; 
    return { captured: true, ledger }; // 攔截成功，結束主流程
}

// 🌟 核心功能 2：處理 AI 自己抓到的名單 (如 [LEAD:xxx] 標籤)
async function processAiExtractedLead({ db, clientId, userId, leadContent, userMsg, lineDisplayName, linePictureUrl, clientDoc }) {
    if (!REGEX_COLLECTOR.phone.test(leadContent) && !REGEX_COLLECTOR.phone.test(userMsg) && !REGEX_COLLECTOR.email.test(leadContent) && !REGEX_COLLECTOR.email.test(userMsg)) return null; 
    
    const parsedLeadName = (leadContent.split('|')[0] || "貴賓").trim(); 
    const displayNameForCard = (lineDisplayName && lineDisplayName !== "Line User") ? lineDisplayName : parsedLeadName;
    
    await db.collection('clients').doc(clientId).collection('leads').add({
        userId, contactInfo: leadContent, displayName: lineDisplayName, pictureUrl: linePictureUrl, 
        createdAt: admin.firestore.FieldValue.serverTimestamp(), status: 'new', source: 'line_ai', tg_notified: false, ai_summarized: false
    });
    
    await db.collection('clients').doc(clientId).collection('members').doc(userId).set({ lastLeadCaptureAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await markFunnelAsLead(clientDoc.ref, userId);
    
    return getLeadConfirmedFlexMessage(displayNameForCard);
}

// ==========================================================
// 🟢 Flex 卡片與 Quick Reply 組裝區
// ==========================================================
function getLeadGuidanceFlexMessage() {
    return { "type": "flex", "altText": "👨‍💼 專員聯繫服務", "contents": { "type": "bubble", "header": { "type": "box", "layout": "vertical", "contents": [ { "type": "text", "text": "👨‍💼 專員聯繫服務", "weight": "bold", "size": "xl", "color": "#ffffff" } ], "backgroundColor": "#0d6efd", "paddingAll": "md" }, "body": { "type": "box", "layout": "vertical", "contents": [ { "type": "text", "text": "系統已收到您的呼叫請求！", "weight": "bold", "size": "md", "color": "#333333", "wrap": true }, { "type": "text", "text": "為節省您的寶貴時間，請在下方直接輸入您的「手機號碼」或「Email」，我們將盡快安排專人與您聯繫。", "size": "sm", "color": "#666666", "wrap": true, "margin": "md" } ] } } };
}

function getLeadConfirmedFlexMessage(customerName) {
    return { "type": "flex", "altText": "【系統通知】資料已受理", "contents": { "type": "bubble", "body": { "type": "box", "layout": "vertical", "contents": [ { "type": "text", "text": "服務需求確認", "weight": "bold", "size": "xl", "color": "#1DB446" }, { "type": "text", "text": `客戶: ${customerName}`, "size": "sm", "color": "#666666", "margin": "md" }, { "type": "text", "text": "✅ 資料已受理", "size": "sm", "color": "#666666" } ] } } };
}

// 🌟 獲取常駐 Quick Reply (極淨版：強制鎖定最多 3 顆)
async function getLeadQuickReply(clientData, memberData, hasShownProducts) {
    const builderSettings = clientData.builder_settings || {};
    const activeEngines = builderSettings.activeEngines || ['Sales', 'O2O', 'Service'];
    const hasSales = activeEngines.includes('Sales');
    const items = [];

    // 🌟 只讀取店長在後台設定的「自訂按鈕」，並且【嚴格鎖死最多 3 組】
    const customReplies = builderSettings.quickReplies || [];
    
    if (customReplies.length > 0) {
        customReplies.slice(0, 3).forEach(qr => { // 👈 這裡改成 3
            if (qr.label && qr.text) {
                const actionText = qr.text.trim();
                if (actionText.startsWith('http://') || actionText.startsWith('https://') || actionText.startsWith('tel:') || actionText.startsWith('line://')) {
                    items.push({ "type": "action", "action": { "type": "uri", "label": qr.label.substring(0, 20), "uri": actionText } });
                } else {
                    items.push({ "type": "action", "action": { "type": "message", "label": qr.label.substring(0, 20), "text": actionText } });
                }
            }
        });
    } else if (hasSales) {
        // 💡 防呆機制：如果店長後台連一個自訂按鈕都沒設定，才給預設按鈕
        items.push({ "type": "action", "action": { "type": "message", "label": "🛍️ 看看熱銷推薦", "text": "請推薦一些熱門商品給我" } });
    }

    // LINE 雖然上限是 13，但我們系統層級只會吐出最多 3 顆
    return items.length > 0 ? { "items": items } : undefined;
}

module.exports = { 
    checkAndCapture, 
    processAiExtractedLead,
    getLeadGuidanceFlexMessage, 
    getLeadConfirmedFlexMessage, 
    getLeadQuickReply 
};