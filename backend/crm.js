/**
 * ====================================================================
 * 👥 CRM Module (crm.js)
 * --------------------------------------------------------------------
 * Version: v2.0.0 (SaaS Multi-tenant Edition)
 * Description: 
 * 1. [Path Fix] 資料讀寫路徑修正為 clients/{id}/members 子集合。
 * 2. [Structure] 移除複合鍵(clientId_userId)，直接使用 userId 作為文件ID。
 * ====================================================================
 */

const admin = require("firebase-admin");

/**
 * 更新或建立會員資料
 */
async function updateMember(db, clientId, userId, displayName = "Line User", pictureUrl = "") {
    if (!clientId || !userId) return;
    
    // 🟢 [SaaS Update] 修正路徑：直接進入該客戶的 members 子集合
    // 舊: db.collection('members').doc(`${clientId}_${userId}`)
    const memberRef = db.collection('clients').doc(clientId).collection('members').doc(userId);

    try {
        const now = admin.firestore.FieldValue.serverTimestamp();
        
        // 1. 先讀取，判斷是否為新會員
        const docSnap = await memberRef.get();

        if (!docSnap.exists) {
            // [NEW MEMBER] 建立新檔案
            await memberRef.set({
                clientId: clientId,   
                userId: userId,
                nickname: displayName,
                pictureUrl: pictureUrl,
                createdAt: now,       // 加入日期
                lastMessageAt: now,   // 最後登入
                platform: "line",
                tier: "Normal",       // 預設等級
                note: ""              // 預設備註
            });
            console.log(`[CRM] New Member Created: ${displayName} (Client: ${clientId})`);
        } else {
            // [EXISTING MEMBER] 只更新變動欄位
            const updateData = {
                lastMessageAt: now
            };
            // 只有當抓到真實名字時，才去更新名字 (避免覆蓋掉舊有的)
            if (displayName && displayName !== "Line User") {
                updateData.nickname = displayName;
            }
            if (pictureUrl) {
                updateData.pictureUrl = pictureUrl;
            }
            await memberRef.update(updateData);
        }

    } catch (error) {
        console.error(`[CRM] Update Error for ${userId}:`, error);
    }
}

/**
 * 讀取會員資料
 */
async function getMember(db, clientId, userId) {
    if (!clientId || !userId) return null;
    
    // 🟢 [SaaS Update] 修正讀取路徑
    const memberRef = db.collection('clients').doc(clientId).collection('members').doc(userId);

    try {
        const docSnap = await memberRef.get();
        if (docSnap.exists) {
            return docSnap.data();
        }
    } catch (error) {
        console.error(`[CRM] Get Error for ${userId}:`, error);
    }
    return null;
}

module.exports = { updateMember, getMember };