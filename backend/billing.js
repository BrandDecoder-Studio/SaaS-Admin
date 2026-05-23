/**
 * 💰 Billing & Logging Module (billing.js)
 * --------------------------------------------------------------------
 * Version: v4.1.1 (🌟 公平定價終極版：統一 4 倍 / 生圖 2 倍 + 尊榮去浮水印 5% 加給)
 * Description:
 * 1. 使用 Transaction 確保扣款原子性，餘額最低為 0。
 * 2. 嚴格寫入客戶專屬子集合 (clients/{cid}/audit_logs)，保留完整欄位。
 * 3. 🌟 [公平定價] 徹底移除動態 margin_rate，全平台統一計費標準，杜絕不公。
 * 4. 🌟 [倍率分流] 一般功能固定 4 倍；沉浸展示間 (0.5K生圖) 基礎成本 1350，專屬 2 倍。
 * 5. 🌟 [尊榮特權] 偵測 remove_watermark 開關，算圖總點數加收 5%。
 * 6. 確保 250 點加值固定費足額扣除，避免被倍率乘數稀釋。
 * */

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const MODULE_VERSION = "v4.1.1";

// 🌟 [莊家費率表] 集中管理所有硬成本定價 (單位: 點)
const COST_TABLE = {
    DB_READ: 0.5,
    AI_TOKEN: 0.02,
};
const BASE_FEE_STANDARD = 150;
const BASE_FEE_CHAT = 100;    
const BASE_FEE_SHOWROOM = 1350; // 🚀 沉浸展示間 0.5K 影像生成基礎成本
const ADDON_FEE_TG_SUMMARY = 250;

// 🌟 [全平台公平定價策略]
const FIXED_MULTIPLIER = 4;     // 一般輕量 API (文字、推演) 用 4 倍
const SHOWROOM_MULTIPLIER = 2;  // 🚀 沉浸展示間專屬 2 倍佛心乘數
const DEFAULT_GLE_WEIGHT = 1.0;

function getCurrentMonthKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}_${m}`;
}

/**
 * 執行計費與日誌記錄 (交易模式)
 */
async function performBillingAndLogging(db, clientId, userId, userMsg, ledger, systemVersion) {
    // 1. 結算「底層硬成本」與「適用倍率」
    let currentBaseFee = BASE_FEE_STANDARD;
    let currentMultiplier = FIXED_MULTIPLIER; // 預設使用 4 倍

    if (ledger.action === "AI_CHAT_ONLY") {
        currentBaseFee = BASE_FEE_CHAT;
    } else if (ledger.action === "AI_SHOWROOM_SYNTHESIS") {
        currentBaseFee = BASE_FEE_SHOWROOM; 
        currentMultiplier = SHOWROOM_MULTIPLIER; 
    } 
    else if (ledger.action === "AI_SHOWROOM_INTENT_SELECTED" || ledger.action === "AI_SHOWROOM_QUEUED_AIDP") {
        currentBaseFee = 50; // 過渡動作免基礎費 (或設為 50)，僅算微量 DB 讀取費
        currentMultiplier = 1; // 乘數降為 1，不賺差價
    }

    const costReads = (ledger.reads || 0) * COST_TABLE.DB_READ;
    const costTokens = (ledger.tokens || 0) * COST_TABLE.AI_TOKEN;
    const totalHardCost = currentBaseFee + costReads + costTokens;
    
    // 計算權重與加值費
    const gleWeight = ledger.gleWeight || DEFAULT_GLE_WEIGHT;
    let addonFees = 0;
    if (ledger.hasTgSummary) {
        addonFees += ADDON_FEE_TG_SUMMARY;
    }

    let safeDetails = ledger.details || "";

    // 準備日誌標題
    let logServiceType = "AI 智能客服應答";
    if (ledger.action === "AI_SHOWROOM_SYNTHESIS") logServiceType = "✨ 沉浸展示間 (0.5K 算圖)";
    else if (ledger.action === "AI_SHOWROOM_INTENT_SELECTED" || ledger.action === "AI_SHOWROOM_QUEUED_AIDP") logServiceType = "📸 展示間系統準備中";
    else if (ledger.hasTgSummary) logServiceType = "🚀 AI 商機情報摘要通報";
    else if (ledger.status === "BLOCKED") logServiceType = "⛔ 黑名單攔截";
    else if (ledger.action === "AI_VISION_ANALYSIS" || ledger.action === "AI_VISION_SEARCH") logServiceType = "🦅 鷹眼視覺分析";
    else if (safeDetails.includes("Prods")) logServiceType = "AI 精準導購拋單";
    else if (safeDetails.includes("Maps")) logServiceType = "AI 門市地圖引導";
    else if (ledger.action === "AI_CHAT_ONLY") logServiceType = "AI 純閒聊 (優惠費率)";

    const monthKey = getCurrentMonthKey();
    const monthlyDocId = `${clientId}_${monthKey}`;

    // 2. 🚀 啟動交易 (Transaction)
    try {
        await db.runTransaction(async (t) => {
            const clientRef = db.collection('clients').doc(clientId);
            const clientDoc = await t.get(clientRef);

            if (!clientDoc.exists) {
                console.error(`[Billing v${MODULE_VERSION}] Client ${clientId} not found.`);
                return;
            }

            const clientData = clientDoc.data();

            // 🌟 [新增] 檢查客戶是否有開啟「尊榮去浮水印」
            const isWatermarkRemoved = clientData.builder_settings && clientData.builder_settings.remove_watermark === true;
            let watermarkMultiplier = 1.0;

            if (ledger.action === "AI_SHOWROOM_SYNTHESIS" && isWatermarkRemoved) {
                watermarkMultiplier = 1.05; // 🌟 算圖總價加收 5%
                safeDetails = (safeDetails ? safeDetails + " | " : "") + "No_Watermark(+5%)";
            }

            // 🌟 結算最終應扣點數：(底層成本 * 套用倍率 * 語系權重 * 浮水印加給) + 固定加值費
            const pointsToDeduct = Math.ceil(totalHardCost * currentMultiplier * gleWeight * watermarkMultiplier) + addonFees;

            // 餘額計算
            const currentBalance = clientData.balance_points || 0;
            let rawBalance = currentBalance - pointsToDeduct;
            if (rawBalance < 0) rawBalance = 0;
            let newBalance = parseFloat(rawBalance.toFixed(2));

            // 準備內部統計日誌 (完整保留結構)
            const internalStats = {
                db_reads: ledger.reads || 0,
                token_usage: ledger.tokens || 0,
                base_fee_applied: currentBaseFee,
                addon_fee_applied: addonFees,
                raw_cost_twd: totalHardCost / 1000,
                profit_multiplier: currentMultiplier, // 紀錄本次真實套用的乘數 (4 或 2)
                watermark_multiplier: watermarkMultiplier, // 🌟 紀錄是否有收 5% 尊榮費
                gle_weight: gleWeight,
                billing_version: MODULE_VERSION,
                system_version: systemVersion
            };

            const publicDetails = {
                service_type: logServiceType,
                query_summary: (userMsg && userMsg.length > 150) ? userMsg.substring(0, 150) + "..." : (userMsg || "無輸入"),
                process_result: ledger.status === "SUCCESS" ? "完成" : "中斷/失敗",
                system_note: safeDetails + (ledger.useGLE ? " [GLE Global Active]" : ""),
                billed_points: `-${pointsToDeduct} PTS`
            };

            // 執行扣款
            t.update(clientRef, {
                balance_points: newBalance,
                last_transaction_at: admin.firestore.FieldValue.serverTimestamp()
            });

            // 嚴格寫入子集合日誌 (保留所有 Metadata)
            const logRef = clientRef.collection('audit_logs').doc(ledger.traceId);
            t.set(logRef, {
                clientId: clientId,           
                traceId: ledger.traceId,      
                operator: userId || "Unknown User",
                action: ledger.action || "UNKNOWN",
                service_type: "SYSTEM_AI",
                target: "System AI",
                clicked: false,               
                details: JSON.stringify({
                    ...publicDetails,
                    user: userId || "System AI",
                    balance_snapshot: newBalance
                }),
                internal_stats: JSON.stringify(internalStats),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userAgent: `LineBot/${systemVersion}`
            });

            // 更新月度統計
            const monthlyRef = db.collection('monthly_stats').doc(monthlyDocId);
            t.set(monthlyRef, {
                clientId: clientId,
                month: monthKey,
                total_points: admin.firestore.FieldValue.increment(pointsToDeduct),
                usage_count: admin.firestore.FieldValue.increment(1),
                last_updated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            console.log(`[Billing v${MODULE_VERSION}] Action: ${ledger.action} | Deducted: ${pointsToDeduct} (Watermark: ${watermarkMultiplier}x) | Balance: ${newBalance}`);
        });

    } catch (e) {
        console.error(`[Billing v${MODULE_VERSION}] 💥 Transaction Failed:`, e);
    }
}

module.exports = { performBillingAndLogging, MODULE_VERSION };