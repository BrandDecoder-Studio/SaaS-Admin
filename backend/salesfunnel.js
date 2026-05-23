/**
 * salesfunnel.js
 * 🚀 漏斗狀態鎖定與文字淨化器 (SaaS 淨化版 v24.2)
 * ------------------------------------------------
 * [更新日誌]
 * 1. 🪦 已物理超渡「黃金三角逼單 QR」：避免 AI 產生發散意圖的按鈕，導致漏斗破裂。
 * 2. 🧹 極致瘦身：移除所有無用的 URL 檢查與文案預設值，降低記憶體開銷。
 * 3. 🎯 目前專職：(A) 判斷漏斗是否鎖定 (B) 清洗 AI 回覆中的 <FUNNEL> 隱藏標籤。
 */

// ==========================================================
// 🔒 漏斗鎖定機制 (Funnel Lock)
// 負責判定客人是否正處於「導購/看圖」的高意圖狀態
// ==========================================================
function isFunnelLocked(userMsg, currentState) {
    if (!currentState || currentState === 'IDLE') return false;
    
    // 如果客人輸入了以下關鍵字，或是正處於展示間狀態，強制鎖定漏斗
    const funnelKeywords = ['換', '再試', '照片', '情境', '買', '多少錢', '下單', '結帳', '看'];
    return funnelKeywords.some(kw => userMsg.includes(kw)) || currentState !== 'IDLE';
}

// ==========================================================
// 🧹 訊息淨化器 (Message Decorator)
// 負責把 AI 吐出來的 <FUNNEL> 內部標籤抹除，只留乾淨的文字給客人
// ==========================================================
function decorateMessage(aiResponseText, productData, brandVibe = 'Default', intentResult = 'UNKNOWN', willShowFlexCard = false, isMultiProduct = false) {
    let cleanText = aiResponseText;

    // 🔍 尋找並抹除 <FUNNEL> 標籤
    const funnelRegex = /<FUNNEL>([\s\S]*?)<\/FUNNEL>/;
    const match = aiResponseText.match(funnelRegex);

    if (match && match[1]) {
        try {
            // 我們現在不需要解析裡面的 buy 或 showroom 參數了，直接抹除即可
            cleanText = aiResponseText.replace(funnelRegex, '').trim();
        } catch (e) { 
            console.warn("⚠️ [SalesFunnel] FUNNEL 標籤清洗失敗"); 
        }
    }

    // 🌟 [總監決策] 物理結紮：不再產生任何會干擾漏斗的文字 QR，永遠回傳空陣列
    return { cleanText: cleanText, quickReplies: [] };
}

module.exports = { isFunnelLocked, decorateMessage };