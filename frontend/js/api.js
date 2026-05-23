/**
 * js/api.js (v22.2.0 - Full Secrets Vault & Enterprise Audit Edition)
 * --------------------------------------------------------------------
 * Feature: 
 * 1. [Security] 實裝 Secrets Vault 機密金庫讀寫，支援 deleteField 物理抹除。
 * 2. [Security] createClient 時強制實作「出生即防護」，父層不留機密欄位並同步初始化金庫。
 * 3. [Architecture] 全面廢除根目錄寫入，將所有 Log 統一收攏至 clients/{cid}/audit_logs。
 * 4. [Feature] 支援 AI 建議標籤獲取 (aiTagSuggest)。
 * 5. [Audit] 🌟 升級企業級稽核日誌，updateClient, saveQA, saveProduct 支援完整 updated_data 紀錄。
 */
import { db, auth } from "./config.js"; 
import { 
    collection, doc, getDoc, getDocs, updateDoc, 
    query, where, orderBy, limit, addDoc, deleteDoc, setDoc,
    serverTimestamp, runTransaction, deleteField,
    vector // 👈 增加這支全新的向量兵器！
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js"; // 👈 升級到支援向量的 10.13.0 版

// [Internal] 統一的日誌記錄器 (Admin 操作記錄)
async function _logAction(clientId, action, summary, details = {}) {
    try {
        if (!clientId) return;
        const user = auth.currentUser ? auth.currentUser.email : "unknown_admin";
        await addDoc(collection(db, "clients", clientId, "audit_logs"), {
            clientId: clientId,
            action: action,
            service_type: "ADMIN_OP",
            timestamp: serverTimestamp(),
            clicked: false,
            traceId: `admin-${Date.now()}`,
            details: JSON.stringify({
                user: user,
                query_summary: summary,
                ...details
            })
        });
    } catch (e) { console.error("Audit Log Error:", e); }
}

// --- Clients ---
export async function getAllClients() { return await getDocs(query(collection(db, "clients"))); }
export async function getClientsByEmail(email) { return await getDocs(query(collection(db, "clients"), where("adminEmail", "==", email))); }
export async function getClientById(id) { return await getDoc(doc(db, "clients", id)); }

// 🌟 [New] 專屬金庫：讀取機密金鑰 (僅 Super Admin 權限能讀到)
export async function getClientSecrets(clientId) {
    return await getDoc(doc(db, "clients", clientId, "secrets", "keys"));
}

// 🌟 [New] 專屬金庫：儲存並抹除主檔機密 (資安關鍵)
export async function saveClientSecrets(clientId, secretData) {
    await _logAction(clientId, "UPDATE_SETTINGS", "更新 LINE/AI 機密金鑰並移入金庫");
    
    // 1. 寫入機密子集合 (金庫)
    await setDoc(doc(db, "clients", clientId, "secrets", "keys"), {
        channelAccessToken: secretData.channelAccessToken || "",
        channelSecret: secretData.channelSecret || "",
        geminiApiKey: secretData.geminiApiKey || "",
        lineBotId: secretData.lineBotId || "",
        updatedAt: serverTimestamp()
    }, { merge: true });

    // 2. 徹底抹除主檔 (父層) 上的舊金鑰，防止 F12 外洩
    return await updateDoc(doc(db, "clients", clientId), {
        channelAccessToken: deleteField(),
        channelSecret: deleteField(),
        geminiApiKey: deleteField(),
        lineBotId: secretData.lineBotId || "" // 這個非機密，可以留一份在主檔方便後端路由
    });
}

// 🌟 升級：支援動態傳入 Action 與完整的 updated_data 紀錄
export async function updateClient(id, data, customAction = null, customSummary = null) {
    const action = customAction || "UPDATE_SETTINGS";
    const summary = customSummary || "更新 AI/系統設定";
    
    await _logAction(id, action, summary, { 
        updated_data: data 
    });
    
    return await updateDoc(doc(db, "clients", id), data);
}

// 🌟 [新增] 抓取所有代理商名單 (供下拉選單使用)
export async function getAllDistributors() {
    return await getDocs(query(collection(db, "distributors")));
}

// 🚀 [Security Upgrade & Agent MVP] 建立客戶時同步寫入代理商歸戶與金庫
export async function createClient(data) {
    try {
        const clientsRef = collection(db, "clients");
        
        // 🌟 雙重攔截：優先使用 admin.js 傳來的 data.agent_id，如果沒有，再去抓網址
        const urlParams = new URLSearchParams(window.location.search);
        const urlAgentId = urlParams.get('agent');
        
        // 如果有手動輸入就用手動的，沒有手動且網址有就用網址的，如果都沒有就是 "official"
        const finalAgentId = data.agent_id || urlAgentId || "official"; 
        
        // 1. 建立純淨的父層資料
        const newClientData = {
            name: data.name,
            adminEmail: data.adminEmail,
            balance_points: 0, 
            lineBotId: "", 
            
            // 🔥 寫入最終確定的代理商 ID
            agent_id: finalAgentId,
            
            builder_settings: {
                industry: "Retail",
                role: "Top Sales",
                responseLength: "Standard",
                activeEngines: ["Sales", "O2O", "Service"],
                activeRules: ["StrictQA", "NoBargain"],
                stores: [],
                quickReplies: []
            },
            createdAt: serverTimestamp()
        };
        
        // 2. 新增父層文件
        const docRef = await addDoc(clientsRef, newClientData);
        
        // 3. 🛡️ 同步初始化機密金庫 (Secrets Vault)
        await setDoc(doc(db, "clients", docRef.id, "secrets", "keys"), {
            channelAccessToken: "",
            channelSecret: "",
            geminiApiKey: "",
            lineBotId: "",
            updatedAt: serverTimestamp()
        });

        // 📝 日誌裡也記一筆，方便您未來查帳
        await _logAction(docRef.id, "ADMIN_ADJUST", `系統開通客戶專案 (歸屬: ${finalAgentId})`);
        return docRef.id;
    } catch (error) {
        console.error("建立客戶專案失敗:", error);
        throw error;
    }
}

// --- Members (CRM) ---
export async function getMembers(clientId) {
    return await getDocs(query(collection(db, "clients", clientId, "members"), orderBy('createdAt', 'desc'), limit(50)));
}
export async function updateMember(id, data) {
    await _logAction(window.currentDbId_API_Hack, "UPDATE_MEMBER", `修改會員資料: ${id}`, { updated_data: data });
    return await updateDoc(doc(db, "clients", window.currentDbId_API_Hack, "members", id), data); 
}

// --- Leads (商機) ---
export async function getLeads(clientId, status = 'all') {
    const ref = collection(db, "clients", clientId, "leads");
    let q = (!status || status === 'all') 
        ? query(ref, orderBy('createdAt', 'desc'), limit(50))
        : query(ref, where('status', '==', status), orderBy('createdAt', 'desc'), limit(50));
    return await getDocs(q);
}
export async function updateLeadStatus(id, newStatus) {
    await _logAction(window.currentDbId_API_Hack, "UPDATE_LEAD", `更新商機狀態: ${newStatus}`, { leadId: id });
    return await updateDoc(doc(db, "clients", window.currentDbId_API_Hack, "leads", id), { status: newStatus });
}

// --- QA ---
export async function getQA(clientId) {
    return await getDocs(query(collection(db, "clients", clientId, "qa"), orderBy("createdAt", "desc"), limit(50)));
}
// 🌟 升級：將完整的 QA 問答內容存入日誌，並【自動提煉 RAG 向量座標】
export async function saveQA(id, data) {
    const action = id ? "UPDATE_QA" : "CREATE_QA";
    const summary = id ? `修改 QA: ${data.question}` : `新增 QA: ${data.question}`;
    
    // ==========================================
    // 🧬 [RAG 升級] QA 知識庫脫水與 DNA 提煉
    // ==========================================
    try {
        // 1. 組合純淨的 QA 搜尋字串
        const textToEmbed = `[問題]:${data.question} [答案]:${data.answer}`.trim();
        console.log("🚀 QA 搜尋 DNA：", textToEmbed);
        
        // 2. 呼叫後端取得座標 (這裡假設您 api.js 裡產生座標的函數叫 getProductEmbedding，若名稱不同請自行替換)
        const embeddingResult = await getProductEmbedding(data.clientId, textToEmbed); 
        
        // 3. 將座標掛載到要存入資料庫的物件上
        if (embeddingResult && embeddingResult.embedding) {
            // 🌟 核心修復：加上 vector() 把普通陣列轉成 Firestore 專屬向量型態！
            data.embedding = vector(embeddingResult.embedding); 
        }
    } catch (e) {
        console.warn("⚠️ QA 座標產生失敗:", e);
    }
    // ==========================================

    if (id) {
        await _logAction(data.clientId, action, summary, { updated_data: data });
        return await updateDoc(doc(db, "clients", data.clientId, "qa", id), data);
    } else {
        await _logAction(data.clientId, action, summary, { updated_data: data });
        return await addDoc(collection(db, "clients", data.clientId, "qa"), { ...data, createdAt: serverTimestamp() });
    }
}
export async function deleteQA(id) {
    await _logAction(window.currentDbId_API_Hack, "DELETE_QA", `刪除 QA: ${id}`);
    return await deleteDoc(doc(db, "clients", window.currentDbId_API_Hack, "qa", id));
}

// --- Products ---
export async function getProducts(clientId) {
    return await getDocs(collection(db, "clients", clientId, "products"));
}
// 🌟 升級：將完整的商品內容(含圖片、URL、標籤)存入日誌
// ▼▼▼ 將 saveProduct 替換為這段 ▼▼▼
export async function saveProduct(id, data) {
    const action = id ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";
    const summary = id ? `修改商品: ${data.name}` : `新增商品: ${data.name}`;
    
    // 🌟 [RAG 終極防護] 攔截 embedding 陣列，把它轉換為 Firestore 的專屬 Vector 格式！
    if (data.embedding && Array.isArray(data.embedding)) {
        data.embedding = vector(data.embedding);
    }

    if (id) {
        await _logAction(data.clientId, action, summary, { updated_data: data });
        return await updateDoc(doc(db, "clients", data.clientId, "products", id), data);
    } else {
        await _logAction(data.clientId, action, summary, { updated_data: data });
        return await addDoc(collection(db, "clients", data.clientId, "products"), { ...data, createdAt: serverTimestamp() });
    }
}

export async function deleteProduct(id) {
    await _logAction(window.currentDbId_API_Hack, "DELETE_PRODUCT", `刪除商品: ${id}`);
    return await deleteDoc(doc(db, "clients", window.currentDbId_API_Hack, "products", id));
}

// --- Billing & Logs ---
export async function addClientPoints(docId, amount, userEmail) {
    const clientRef = doc(db, "clients", docId);
    await runTransaction(db, async (transaction) => {
        const clientDoc = await transaction.get(clientRef);
        if (!clientDoc.exists()) throw "Document does not exist!";
        const newBalance = (clientDoc.data().balance_points || 0) + Number(amount);
        transaction.update(clientRef, { balance_points: newBalance });
        const logRef = doc(collection(db, "clients", docId, "audit_logs"));
        transaction.set(logRef, {
            clientId: docId,
            action: "ADMIN_ADJUST",
            service_type: "BILLING",
            dedicted_points: Number(amount),
            timestamp: serverTimestamp(),
            clicked: false,
            details: JSON.stringify({ user: userEmail, amount: amount, query_summary: "人工儲值/扣款" })
        });
    });
}

export async function getAuditLogs(clientId) {
    return await getDocs(query(collection(db, "clients", clientId, "audit_logs"), orderBy("timestamp", "desc"), limit(100)));
}

export async function getStatsLogs(clientId) {
    return await getDocs(query(collection(db, "clients", clientId, "audit_logs"), orderBy("timestamp", "desc"), limit(1000)));
}

export async function getClickLogs(clientId) {
    return await getDocs(query(collection(db, "clients", clientId, "click_logs"), orderBy("clickedAt", "desc"), limit(1000)));
}

export async function getMonthlyStats(docId) { return await getDoc(doc(db, "monthly_stats", docId)); }
export function setCurrentDbId(id) { window.currentDbId_API_Hack = id; }

// --- Applications ---
// 🌟 獲取待審核申請單 (相容 pending 與 PENDING)
export async function getPendingApplications() {
    // 使用 "in" 陣列，不管前台傳大寫還小寫，通通抓出來
    const q = query(
        collection(db, "applications"), 
        where("status", "in", ["pending", "PENDING"])
    );
    const snapshot = await getDocs(q);
    
    // 順便在程式裡幫您依照時間由新到舊排好
    const docsArray = [];
    snapshot.forEach(doc => docsArray.push(doc));
    docsArray.sort((a, b) => {
        const timeA = a.data().submitAt?.seconds || 0;
        const timeB = b.data().submitAt?.seconds || 0;
        return timeB - timeA;
    });
    
    return docsArray; // 回傳整理好的陣列
}
export async function updateApplicationStatus(appId, newStatus) {
    return await updateDoc(doc(db, "applications", appId), { status: newStatus, processedAt: serverTimestamp() });
}

// ▲▲▲ 替換為這段 (替換後) ▲▲▲
// --- AI Tools ---
export async function getAiTagSuggestions(clientId, imageUrl) {
    const url = `https://brand-decoder-bot-217800246535.asia-east1.run.app?action=aiTagSuggest`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, imageUrl })
    });
    const data = await response.json();
    if (!response.ok || data.status === 'error') throw new Error(data.message || 'API 請求失敗');
    
    // 🌟 [升級] 不再只回傳 tags，而是回傳整包 audit 報告，包含隱藏的 system_route
    return {
        tags: data.tags || [],
        system_route: data.system_route || "VTO_PERSON" // 預設給一個安全的路由防呆
    };
}

// 🚀 [RAG 升級] 呼叫後端 Gemini 產生商品文本的向量座標
export async function getProductEmbedding(clientId, text) {
    const url = `https://brand-decoder-bot-217800246535.asia-east1.run.app?action=getEmbedding`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, text })
    });
    const data = await response.json();
    if (!response.ok || data.status === 'error') throw new Error(data.message || 'API 請求失敗');
    
    return {
        embedding: data.embedding || null
    };
}


// 🌟 [新增] 代理商專用：獲取歸戶客戶清單
export async function getPartnerClients(partnerId) {
    return await getDocs(query(collection(db, "clients"), where("agent_id", "==", partnerId)));
}

// 🌟 [新增] 代理商專用：撈取單一客戶的「劃撥點數紀錄」 (Single Source of Truth)
export async function getClientTransferLogs(clientId) {
    const logsRef = collection(db, "clients", clientId, "audit_logs");
    // 只撈取由代理商劃撥的交易紀錄
    const q = query(logsRef, where("action", "==", "PARTNER_TOPUP"));
    return await getDocs(q);
}

// 🌟 [新增] 代理商專用：原子化劃撥交易 (銀行等級安全 - 防負數攻擊版)
export async function transferPoints(partnerId, clientId, amount) {
    const partnerRef = doc(db, "distributors", partnerId);
    const clientRef = doc(db, "clients", clientId);
    const transferAmount = Number(amount);

    // 🚨 終極保全防線：嚴格禁止負數、零、以及小數點！
    if (isNaN(transferAmount) || transferAmount <= 0 || !Number.isInteger(transferAmount)) {
        throw new Error("❌ 系統安全拒絕：劃撥點數必須為正整數，不可為零、負數或包含小數點！");
    }

    return await runTransaction(db, async (transaction) => {
        const pSnap = await transaction.get(partnerRef);
        const cSnap = await transaction.get(clientRef);

        if (!pSnap.exists() || !cSnap.exists()) throw new Error("資料不存在");
        
        const pBalance = pSnap.data().balance_points || 0;
        
        // 檢查餘額是否足夠
        if (pBalance < transferAmount) throw new Error("您的餘額不足以支付此筆劃撥");

        // 1. 扣除代理商餘額
        transaction.update(partnerRef, { balance_points: pBalance - transferAmount });
        
        // 2. 增加客戶餘額
        const cBalance = cSnap.data().balance_points || 0;
        transaction.update(clientRef, { balance_points: cBalance + transferAmount });

        // 3. 寫入客戶的審計日誌 (官方收據)
        const logRef = doc(collection(db, "clients", clientId, "audit_logs"));
        transaction.set(logRef, {
            clientId: clientId,
            action: "PARTNER_TOPUP",
            service_type: "BILLING",
            dedicted_points: transferAmount,
            timestamp: serverTimestamp(),
            clicked: false,
            details: JSON.stringify({ 
                partnerId: partnerId, 
                amount: transferAmount, 
                query_summary: `代理商 (${partnerId}) 劃撥入帳` 
            })
        });
    });
}

// 🌟 [新增] 代理商專用：撈取推廣分潤報表 (模式二：原廠代收抽成)
export async function getPartnerCommissions(partnerId) {
    const commRef = collection(db, "distributors", partnerId, "commissions");
    return await getDocs(query(commRef)); 
}


// 🌟 [修正版] 總部專用：替客戶手動儲值，並「自動計算代理商分潤」 (符合嚴格讀寫順序)
export async function adminTopUpAndDistribute(clientId, pointsToAdd, paidAmount) {
    const clientRef = doc(db, "clients", clientId);

    // 嚴格檢查：點數必須是正整數
    if (isNaN(pointsToAdd) || pointsToAdd <= 0 || !Number.isInteger(pointsToAdd)) {
        throw new Error("❌ 儲值點數必須為正整數！");
    }

    return await runTransaction(db, async (transaction) => {
        // ==========================================
        // 📖 READ PHASE: 讀取階段 (必須全部集中在這裡)
        // ==========================================
        const clientSnap = await transaction.get(clientRef);
        if (!clientSnap.exists()) throw new Error("客戶資料不存在");

        const clientData = clientSnap.data();
        const currentBalance = clientData.balance_points || 0;
        const agentId = clientData.agent_id; // 抓出這家店的歸屬代理商

        let agentSnap = null;
        let agentRef = null;
        // 如果有代理商，在「讀取階段」就先把它撈出來！
        if (agentId) {
            agentRef = doc(db, "distributors", agentId);
            agentSnap = await transaction.get(agentRef);
        }

        // ==========================================
        // ✍️ WRITE PHASE: 寫入階段 (一旦開始寫入，絕對不能再 get)
        // ==========================================
        
        // 1. 幫客戶加點數
        transaction.update(clientRef, { balance_points: currentBalance + pointsToAdd });

        // 2. 寫入客戶的官方 Audit Log (留存收據)
        const logRef = doc(collection(db, "clients", clientId, "audit_logs"));
        transaction.set(logRef, {
            clientId: clientId,
            action: "ADMIN_TOPUP",
            service_type: "BILLING",
            deducted_points: pointsToAdd, // 這裡幫您修正為 deducted_points
            timestamp: serverTimestamp(),
            clicked: false,
            details: JSON.stringify({ note: "總部人工儲值", paidAmount: paidAmount })
        });

        // 3. 💸 核心分潤引擎計算與寫入
        if (agentId && agentSnap && agentSnap.exists()) {
            const agentData = agentSnap.data();
            const rate = agentData.commission_rate || 0;
            
            // 計算分潤金額 (以輸入的 paidAmount 為基準 * 代理商的 %)
            const earned = Math.floor(paidAmount * rate);

            // 🌟 只有分潤金額大於 0，才寫入代理商帳本 (防禦 paidAmount = 0 的公關送點情況)
            if (earned > 0) {
                const commRef = doc(collection(db, "distributors", agentId, "commissions"));
                transaction.set(commRef, {
                    clientId: clientId,
                    clientName: clientData.name,
                    amount: paidAmount,       // 客戶實際花費(排除開通費後的數字)
                    earned: earned,            // 代理商賺到的獎金
                    rate: rate,
                    status: "pending",        // 狀態：未結算 (等待總部發錢)
                    timestamp: serverTimestamp()
                });
            }
        }
    });
}

// 🌟 刪除作廢申請單 (配合前端垃圾桶按鈕)
export async function deleteApplication(appId) {
    return await deleteDoc(doc(db, "applications", appId));
}

// 🌟 [修正版] 總部結算引擎：修復 path 錯誤，將 Query 移至 Transaction 外部
export async function settlePartnerCommissions(partnerId) {
    const partnerRef = doc(db, "distributors", partnerId);
    const commRef = collection(db, "distributors", partnerId, "commissions");

    // 1. 先在保險箱(Transaction)外部，把待結算的帳單全部撈出來盤點
    const q = query(commRef, where("status", "==", "pending"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) throw new Error("目前沒有可結算的獎金紀錄");

    let totalSettle = 0;
    const pendingDocs = [];
    
    // 把每一筆帳單的金額加總，並把它的「文件位址 (ref)」存起來準備進保險箱用
    snapshot.forEach(d => {
        totalSettle += (d.data().earned || 0);
        pendingDocs.push(d.ref); 
    });

    // 2. 啟動保險箱，進行原子化結算
    return await runTransaction(db, async (transaction) => {
        // 先讀取代理商的總帳本
        const pSnap = await transaction.get(partnerRef);
        const currentPaid = pSnap.data().paid_amount || 0;

        // 寫入 1：更新代理商總發放金額
        transaction.update(partnerRef, { 
            paid_amount: currentPaid + totalSettle 
        });

        // 寫入 2：將剛才盤點的帳單，逐一蓋上「已發放」的印章
        pendingDocs.forEach(ref => {
            transaction.update(ref, { 
                status: "paid", 
                settledAt: serverTimestamp() 
            });
        });

        return totalSettle;
    });
}

// ==========================================
// 🌟 [新增] 商品分類 (Categories) 管理
// ==========================================

export async function getCategories(clientId) {
    return await getDocs(collection(db, "clients", clientId, "categories"));
}

export async function saveCategory(clientId, categoryId, data) {
    const action = categoryId ? "UPDATE_CATEGORY" : "CREATE_CATEGORY";
    const summary = categoryId ? `修改分類: ${data.name}` : `新增分類: ${data.name}`;
    
    await _logAction(clientId, action, summary, { updated_data: data });

    if (categoryId) {
        return await updateDoc(doc(db, "clients", clientId, "categories", categoryId), data);
    } else {
        return await addDoc(collection(db, "clients", clientId, "categories"), { 
            ...data, 
            createdAt: serverTimestamp() 
        });
    }
}

export async function deleteCategory(clientId, categoryId) {
    await _logAction(clientId, "DELETE_CATEGORY", `刪除分類 ID: ${categoryId}`);
    return await deleteDoc(doc(db, "clients", clientId, "categories", categoryId));
}
