/**
 * js/modules/admin.js
 * ------------------------------------------------
 * 負責處理「系統日誌 (Audit Logs)」、「管理員加值」與「新專案申請審核」。
 * 🌟 [CRM Upgrade] 日誌列表與明細視窗現已支援顯示 LINE 暱稱 (Operator)。
 * 🌟 [P0 Upgrade] 支援違規停權存證上傳 (GCS) 與日誌列表存證圖片預覽。
 * 🌟 [Fix] 已將 toggleClientStatus 邏輯移轉回主程式 app.js 統一管理。
 * 🌟 [Feature] 新增「儲值與分潤精靈」(initAdminTopUp)。
 * 🌟 [New] 新增「代理商結算精靈」(showSettlementWizard)。
 * 🌟 [Fix] 待審核清單新增「作廢刪除」功能 (deleteApplication)。
 */
import * as API from '../api.js';
import { toggleLoader, formatNumber, getVal, setText } from '../utils.js?v=bypass';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

window.logDataCache = window.logDataCache || {};
window.appDataCache = window.appDataCache || {};
let lastLogFetchTime = 0; 
const LOG_COOLDOWN = 60000; 

const ACTION_MAP = {
    'UPDATE_PRODUCT': '📦 修改商品', 'CREATE_PRODUCT': '➕ 新增商品', 'DELETE_PRODUCT': '❌ 刪除商品',
    'UPDATE_QA':      '📚 修改 QA', 'UPDATE_MEMBER':  '👤 會員管理', 'UPDATE_SETTINGS':'⚙️ 系統設定',
    'UPDATE_LEAD':    '🚩 商機狀態', 'AI_FULL_SEARCH': '🔍 導購搜尋', 'AI_CHAT':        '💬 一般對話',
    'ADMIN_ADJUST':   '💵 人工儲值/扣款', 'CLIENT_SUSPENDED': '🔴 強制停權', 'CLIENT_ACTIVATED': '🟢 恢復專案'
};
const LOG_TYPE_MAP = { 'SYSTEM_AI': '🤖 AI 智能回覆', 'ADMIN_OP':  '👮 Admin 管理', 'BILLING':   '💰 金流紀錄' };

export async function loadAuditLogs(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && (now - lastLogFetchTime < LOG_COOLDOWN)) return;

    const filterInput = getVal('log-filter-type') || 'all';
    const startDateStr = getVal('log-date-start');
    const endDateStr = getVal('log-date-end');

    const div = document.getElementById('log-list-container');
    if(div) div.innerHTML = '<tr><td colspan="5" class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>';

    const snap = await API.getAuditLogs(window.currentDbId);
    lastLogFetchTime = Date.now();

    let count = 0;
    // 🌟 核心修復 1：建立 HTML 緩衝區，取代低效且易出錯的 innerHTML +=
    let htmlBuffer = ''; 

    snap.forEach(doc => {
        const l = doc.data();
        let pDet = {};
        if (typeof l.details === 'object' && l.details !== null) {
            pDet = l.details;
        } else if (typeof l.details === 'string') {
            try { pDet = JSON.parse(l.details); } catch(e){}
        }

        const dbServiceType = l.service_type || "ADMIN_OP";
        let displayType = pDet.service_type || LOG_TYPE_MAP[dbServiceType] || dbServiceType;

        if (window.isSuperUser && l.ai_model) { displayType += ` <span class="badge bg-secondary ms-1" style="font-size:0.65rem">${l.ai_model}</span>`; }

        if (filterInput !== 'all' && dbServiceType !== filterInput) return;

        // 🌟 核心修復 2：極致安全的日期判斷 (避開 l.timestamp 缺失導致的隱性崩潰)
        const logMs = l.timestamp?.seconds ? l.timestamp.seconds * 1000 : 0;
        if (startDateStr || endDateStr) {
            const startMs = startDateStr ? new Date(startDateStr).getTime() : null;
            const endMs = endDateStr ? new Date(endDateStr).getTime() : null;

            if (startMs && !isNaN(startMs) && logMs < startMs) return;
            if (endMs && !isNaN(endMs) && logMs > endMs) return;
        }

        count++;

        let rawPts = l.deducted_points || pDet.deducted_points || pDet.billed_points || pDet.amount || 0;
        let ptsNum = parseFloat(String(rawPts).replace(/[^\d.-]/g, '')) || 0;
        let ptsHtml = '<span class="text-muted">-</span>';
        if (ptsNum < 0) ptsHtml = `<span class="text-danger fw-bold">${formatNumber(ptsNum)}</span>`;
        if (ptsNum > 0) ptsHtml = `<span class="text-success fw-bold">+${formatNumber(ptsNum)}</span>`;

        let operatorName = l.operator || pDet.user || (dbServiceType === "SYSTEM_AI" ? "System AI" : "系統操作");
        let operatorBadge = `<span class="badge bg-info text-dark border me-1 fw-normal"><i class="bi bi-person-fill"></i> ${operatorName}</span>`;

        let rawAction = pDet.query_summary || l.action;
        let actionLabel = ACTION_MAP[l.action] ? `<span class="fw-bold text-primary">[${ACTION_MAP[l.action]}]</span> ` : '';

        let evidenceBadge = (pDet.updated_data && pDet.updated_data.evidence_url) ? ` <a href="${pDet.updated_data.evidence_url}" target="_blank" class="badge bg-danger ms-1 text-decoration-none shadow-sm" title="點擊查看證據"><i class="bi bi-image"></i> 存證</a>` : '';

        let displaySummary = operatorBadge + actionLabel + rawAction + evidenceBadge;
        const timeStr = logMs > 0 ? new Date(logMs).toLocaleString() : '未知時間';

        // 將組裝好的 HTML 放入緩衝區
        htmlBuffer += `<tr>
            <td class="small text-muted" style="white-space:nowrap;">${timeStr}</td>
            <td><span class="badge bg-light text-dark border">${displayType}</span></td>
            <td class="text-end">${ptsHtml}</td>
            <td class="small text-truncate" style="max-width: 300px;">${displaySummary}</td>
            <td><button onclick="window.openLogDetail('${doc.id}')" class="btn btn-sm btn-outline-secondary">🔍</button></td>
        </tr>`;

        window.logDataCache[doc.id] = { ...l, parsedDetails: pDet, displayType, displaySummary, ptsNum, operatorName };
    });

    if (div) {
        if (count === 0) {
            div.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-muted"><i class="bi bi-card-text display-3 text-secondary opacity-25 d-block mb-2"></i>目前沒有符合條件的日誌</td></tr>';
        } else {
            // 🌟 核心修復 3：DOM 防呆機制。避免瀏覽器將 <tr> 標籤默默刪除！
            if (div.tagName.toLowerCase() !== 'tbody') {
                div.innerHTML = `<div class="table-responsive"><table class="table table-sm table-hover align-middle"><tbody>${htmlBuffer}</tbody></table></div>`;
            } else {
                div.innerHTML = htmlBuffer;
            }
        }
    }

    const countBadge = document.getElementById('log-count-badge');
    if (countBadge) countBadge.innerText = `共 ${count} 筆`;
}

export function openLogDetail(id) {
    const l = window.logDataCache[id];
    if (!l) return; 
    
    const userView = document.getElementById('log-user-view');
    const adminView = document.getElementById('log-admin-view');
    
    const evUrl = l.parsedDetails?.updated_data?.evidence_url;
    const evBtnHtml = evUrl ? `<div class="mt-3"><a href="${evUrl}" target="_blank" class="btn btn-sm btn-outline-danger fw-bold shadow-sm"><i class="bi bi-image"></i> 點擊查看違規存證照片</a></div>` : '';
    
    if (window.isSuperUser) {
        userView.style.display = 'none'; 
        adminView.style.display = 'block';
        const cleanLog = { ...l };
        if (cleanLog.parsedDetails) { cleanLog.details = cleanLog.parsedDetails; delete cleanLog.parsedDetails; }
        delete cleanLog.displayType; delete cleanLog.displaySummary; delete cleanLog.ptsNum; delete cleanLog.operatorName;
        
        const jsonStr = JSON.stringify(cleanLog, null, 2);
        document.getElementById('log-content').innerHTML = evUrl ? `${evBtnHtml}<pre class="mt-3"><code>${jsonStr}</code></pre>` : jsonStr;
        
    } else {
        adminView.style.display = 'none'; 
        userView.style.display = 'block';
        const timestamp = l.timestamp?.seconds ? new Date(l.timestamp.seconds * 1000).toLocaleString() : '未知時間';
        setText('lu-time', timestamp);
        const displayType = l.displayType || '系統自動服務';
        document.getElementById('lu-type').innerHTML = `<span class="badge bg-primary">${displayType.replace(/<[^>]*>?/gm, '')}</span>`; 
        
        const querySummary = l.parsedDetails?.query_summary || l.action || '系統背景執行';
        const opName = l.operatorName || "系統";
        
        document.getElementById('lu-query').innerHTML = `【${opName}】${querySummary} ${evBtnHtml}`;

        const ptsNum = l.ptsNum || 0;
        const ptsEl = document.getElementById('lu-pts');
        if (ptsNum < 0) { ptsEl.innerText = `${ptsNum} 點`; ptsEl.className = "text-danger fw-bold"; }
        else if (ptsNum > 0) { ptsEl.innerText = `+${ptsNum} 點`; ptsEl.className = "text-success fw-bold"; }
        else { ptsEl.innerText = "0 點"; ptsEl.className = "text-muted"; }
    }
    if (window.logDetailModal) window.logDetailModal.show();
}

export async function adminAddPoints() { 
    const amount = getVal('admin-points-input'); 
    if(!amount) return;
    const adminEmail = window.document.getElementById('user-display')?.innerText || "SuperAdmin";
    await API.addClientPoints(window.currentDocId, amount, adminEmail);
    Swal.fire('成功', '點數調整成功', 'success'); 
    if (window.loadBillingStats) window.loadBillingStats();
}

export async function initAdminTopUp(clientId, clientName) {
    const { value: formValues } = await Swal.fire({
        title: `儲值與分潤作業`,
        html: `
            <div class="text-start mb-3 small text-muted">目前操作客戶：<strong class="text-dark">${clientName}</strong></div>
            <div class="form-floating mb-3">
                <input id="swal-points" class="form-control" type="number" min="1" placeholder="例如: 10000">
                <label for="swal-points">1. 欲發放點數 (正整數)</label>
            </div>
            <div class="form-floating mb-2">
                <input id="swal-amount" class="form-control" type="number" min="0" placeholder="例如: 10000">
                <label for="swal-amount">2. 分潤計算基準額 (NT$)</label>
            </div>
            <div class="text-start text-danger small">
                <i class="bi bi-info-circle"></i> 提示：若總收費 15,000 (含 5,000 開通費)，上方基準額請輸入 10000，系統將自動排除開通費並計算代理商抽成。若無歸屬代理商，系統會自動忽略分潤機制。
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '確認發放與入帳',
        confirmButtonColor: '#0d6efd',
        cancelButtonText: '取消',
        preConfirm: () => {
            const p = document.getElementById('swal-points').value;
            const a = document.getElementById('swal-amount').value;
            if (!p || Number(p) <= 0 || !Number.isInteger(Number(p))) {
                Swal.showValidationMessage('請輸入正確的整數點數！');
                return false;
            }
            return { points: Number(p), amount: Number(a || p) };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: '分潤引擎運算中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            await API.adminTopUpAndDistribute(clientId, formValues.points, formValues.amount);
            Swal.fire('入帳成功！', '點數已順利發放，若該客戶有歸屬代理商，分潤也已自動記入帳冊！', 'success');
            if(window.loadClientsForSuperAdmin) window.loadClientsForSuperAdmin();
            else window.location.reload(); 
        } catch (e) {
            Swal.fire('系統錯誤', e.message || e, 'error');
        }
    }
}

export async function updatePendingAppCount() {
    if (!window.isSuperUser) return; 
    try {
        if (typeof API.getPendingApplications === "function") {
            const snap = await API.getPendingApplications();
            const badge = document.getElementById('pending-app-count');
            if (badge) { 
                if (snap.size > 0) { 
                    badge.innerText = snap.size; 
                    badge.style.display = 'inline-block'; 
                } else { 
                    badge.style.display = 'none'; 
                } 
            }
        }
    } catch(e) { console.warn("App count failed", e); }
}

export async function openApplicationsModal() {
    if (!window.isSuperUser) return; 
    if(window.applicationsModal) window.applicationsModal.show(); 
    toggleLoader('loader-applications', true);
    
    const container = document.getElementById('application-list-container'); 
    const emptyState = document.getElementById('app-empty-state'); 
    container.innerHTML = '';
    
    try {
        // 🌟 [新增] 先抓取代理商名單，建立一個 ID 與 名稱的快速對照表
        const distSnap = await API.getAllDistributors();
        const agentNameMap = {};
        distSnap.forEach(d => {
            agentNameMap[d.id] = d.data().name; // 建立如 {"LianChuang_001": "聯創整合行銷"} 的對照
        });

        const snap = await API.getPendingApplications(); 
        toggleLoader('loader-applications', false);
        
        if (!snap || snap.length === 0) { 
            emptyState.style.display = 'block'; 
            document.querySelector('.table-responsive').style.display = 'none'; 
        } else {
            emptyState.style.display = 'none'; 
            document.querySelector('.table-responsive').style.display = 'block';
            
            snap.forEach(doc => {
                const data = doc.data(); 
                window.appDataCache[doc.id] = data; 
                
                const submitTime = data.submitAt ? new Date(data.submitAt.seconds * 1000).toLocaleString() : '未知時間';
                
                // 🌟 [關鍵修正] 找出對應的經銷商名稱，若找不到則顯示 ID
                const agentName = agentNameMap[data.agent_id] || data.agent_id || "官方直客";

                let serviceText = data.serviceType || "企業採購 (待聯絡)";
                
                // 🌟 [視覺優化] 如果是經銷商件，直接將標題改為「經銷商名稱 + 推薦」
                if (serviceText.includes('經銷商推薦') && data.agent_id !== 'official') {
                    serviceText = `${agentName} 推薦`;
                }

                let badgeClass = "bg-secondary text-white"; 
                if (serviceText.includes('5000') || serviceText.includes('5,000')) {
                    badgeClass = "bg-warning text-dark border-warning"; 
                } else if (data.agent_id && data.agent_id !== "official") {
                    badgeClass = "bg-primary text-white border-primary"; // 代理商件一律顯示藍色
                }

                let badgeHtml = `<span class="badge ${badgeClass} border shadow-sm">${serviceText}</span>`;

                // 保留下方的小標籤供雙重確認
                if (data.agent_id && data.agent_id !== "official") {
                    badgeHtml += `<div class="mt-1"><span class="badge bg-info text-dark border border-info shadow-sm" style="font-size: 0.7rem;"><i class="bi bi-diagram-3-fill"></i> ID: ${data.agent_id}</span></div>`;
                }

                container.innerHTML += `
                    <tr>
                        <td class="small text-muted">${submitTime}</td>
                        <td class="fw-bold">${data.name || '未填寫'}</td>
                        <td>${data.phone || '未填寫'}</td>
                        <td class="text-primary fw-bold">${data.email || '未填寫'}</td>
                        <td>${badgeHtml}</td>
                        <td class="text-end" style="white-space: nowrap;">
                            <button onclick="window.approveApplication('${doc.id}')" class="btn btn-sm btn-success fw-bold shadow-sm me-1">核准</button>
                            <button onclick="window.deleteApplication('${doc.id}')" class="btn btn-sm btn-outline-danger shadow-sm" title="作廢此單"><i class="bi bi-trash3"></i></button>
                        </td>
                    </tr>`;
            });
        }
    } catch(e) { 
        console.error("載入申請單失敗:", e);
        toggleLoader('loader-applications', false); 
    }
}

export async function approveApplication(appId) {
    if (!window.isSuperUser) return; 
    const appData = window.appDataCache[appId]; 
    if (!appData) return;
    
    const confirmResult = await Swal.fire({ 
        title: '確認開通？', 
        html: `即將為 <b>${appData.name}</b> 建立專案。`, 
        icon: 'info', 
        showCancelButton: true 
    });
    
    if (confirmResult.isConfirmed) { 
        try { 
            Swal.fire({ title: '建置中...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } }); 
            await API.createClient({ name: appData.name, adminEmail: appData.email }); 
            await API.updateApplicationStatus(appId, 'completed'); 
            Swal.fire('成功！', `專案已建立。`, 'success'); 
            openApplicationsModal(); 
            updatePendingAppCount(); 
            if(window.loadClientsForSuperAdmin) window.loadClientsForSuperAdmin(); 
        } catch (e) { Swal.fire('錯誤', e.message, 'error'); } 
    }
}

// 🌟 [新增] 刪除作廢申請單邏輯
export async function deleteApplication(appId) {
    if (!window.isSuperUser) return; 
    const confirmResult = await Swal.fire({ 
        title: '確認作廢申請單？', 
        text: "若客戶逾期未付款或重複申請，可將此單作廢移除。此動作無法復原！", 
        icon: 'warning', 
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: '確認作廢'
    });
    
    if (confirmResult.isConfirmed) { 
        try { 
            Swal.fire({ title: '刪除中...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } }); 
            await API.deleteApplication(appId); 
            Swal.fire('已作廢', `申請單已成功作廢並移除。`, 'success'); 
            openApplicationsModal(); // 重新整理列表
            updatePendingAppCount(); // 更新右上角紅點數字
        } catch (e) { Swal.fire('錯誤', e.message, 'error'); } 
    }
}

export async function createNewClient() {
    let optionsHtml = '<option value="">-- 官方直客 (無代理商) --</option>';
    try {
        const distSnap = await API.getAllDistributors();
        distSnap.forEach(doc => {
            const data = doc.data();
            optionsHtml += `<option value="${doc.id}">🏢 ${data.name} (${doc.id})</option>`;
        });
    } catch (e) {
        console.warn("無法載入代理商名單", e);
    }

    const { value: formValues } = await Swal.fire({ 
        title: '手動新增專案', 
        html: `
            <input id="swal-input1" class="swal2-input" placeholder="專案名稱 (必填)">
            <input id="swal-input2" class="swal2-input" placeholder="管理員 Email (必填)">
            <hr class="my-3 opacity-25">
            <div class="text-start px-2">
                <label class="small text-muted fw-bold mb-1"><i class="bi bi-diagram-3 me-1"></i>歸屬代理商 (選填)</label>
                <select id="swal-input-agent" class="form-select mt-1 border-secondary" style="font-size: 0.95rem; height: 45px;">
                    ${optionsHtml}
                </select>
                <div class="small text-muted mt-2">※ 若為官方直客請保持預設。</div>
            </div>
        `, 
        showCancelButton: true, 
        preConfirm: () => { 
            const name = document.getElementById('swal-input1').value.trim();
            const adminEmail = document.getElementById('swal-input2').value.trim();
            const agentId = document.getElementById('swal-input-agent').value;

            if (!name || !adminEmail) {
                Swal.showValidationMessage('請填寫專案名稱與管理員 Email');
                return false;
            }

            return { name, adminEmail, agentId }; 
        } 
    });
    
    if (formValues) { 
        try { 
            Swal.fire({ title: '專案建置中...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } }); 
            
            await API.createClient({ 
                name: formValues.name, 
                adminEmail: formValues.adminEmail,
                agent_id: formValues.agentId || "official" 
            }); 
            
            Swal.fire('成功', '客戶專案已建立並歸戶！', 'success'); 
            if(window.loadClientsForSuperAdmin) window.loadClientsForSuperAdmin(); 
        } catch(e) { 
            Swal.fire('系統錯誤', e.message, 'error'); 
        } 
    }
}

export function previewEvidenceImage(event) {
    const file = event.target.files[0];
    const previewContainer = document.getElementById('suspend-preview-container');
    const previewImg = document.getElementById('suspend-preview-img');

    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            previewContainer.style.display = 'block';
        }
        reader.readAsDataURL(file);
    } else {
        previewImg.src = '';
        previewContainer.style.display = 'none';
    }
}

export async function executeSuspension() {
    if (!window.currentDocId) return;

    const reason = document.getElementById('suspend-reason').value;
    const memo = document.getElementById('suspend-memo').value.trim();
    const fileInput = document.getElementById('suspend-evidence-file');
    const file = fileInput.files[0];

    if (!file) {
        Swal.fire('驗證錯誤', '必須上傳「存證截圖」才能執行停權！', 'warning');
        return;
    }

    try {
        Swal.fire({ title: '證據上傳與封鎖中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const storage = getStorage();
        const ext = file.name.split('.').pop();
        const fileName = `evidence_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
        const storageRef = ref(storage, `clients/${window.currentDocId}/suspensions/${fileName}`);

        await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(storageRef);

        const updateData = {
            status: 'SUSPENDED',
            suspend_reason: reason,
            suspend_memo: memo,
            evidence_url: downloadUrl,
            suspended_at: new Date().toISOString()
        };

        const logSummary = `🔴 強制停權: ${reason}`;

        await API.updateClient(
            window.currentDocId,
            updateData,
            'CLIENT_SUSPENDED',
            logSummary
        );

        window.currentClientData.status = 'SUSPENDED';
        if (window.updateStatusButtonUI) window.updateStatusButtonUI('SUSPENDED');

        const modalEl = document.getElementById('suspensionModal');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
        
        Swal.fire('停權成功', '已物理斷路，違規證據已安全封存至金庫。', 'success');

    } catch (error) {
        console.error("Suspension Error:", error);
        Swal.fire('系統錯誤', `停權處置失敗: ${error.message}`, 'error');
    }
}

export async function showSettlementWizard() {
    try {
        Swal.fire({ title: '載入各代理商帳務中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const distSnap = await API.getAllDistributors();
        let optionsHtml = '';
        let agentMap = {};
        let hasPending = false;

        const promises = distSnap.docs.map(async (docSnap) => {
            const pid = docSnap.id;
            const data = docSnap.data();
            
            const commSnap = await API.getPartnerCommissions(pid);
            let pendingSum = 0;
            let pendingItems = []; 
            
            commSnap.forEach(c => {
                const cData = c.data();
                if (cData.status === 'pending') {
                    pendingSum += (cData.earned || 0);
                    pendingItems.push(cData);
                }
            });

            pendingItems.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            agentMap[pid] = { name: data.name, pending: pendingSum, items: pendingItems };

            if (pendingSum > 0) {
                hasPending = true;
                return `<option value="${pid}">🏢 ${data.name} (待結: NT$ ${pendingSum})</option>`;
            } else {
                return `<option value="${pid}" disabled>🏢 ${data.name} (無欠款)</option>`;
            }
        });

        const optionsArray = await Promise.all(promises);
        optionsHtml = optionsArray.join('');
        
        Swal.close();

        if (!hasPending) {
            return Swal.fire('結算中心', '目前所有代理商皆無待結算帳款！', 'info');
        }

        const { value: partnerId } = await Swal.fire({
            title: '💰 代理商結算中心',
            html: `
                <div class="text-start mb-2 small text-muted">請選擇要執行結算的代理商：</div>
                <select id="swal-settle-agent" class="form-select border-primary fw-bold" style="height: 45px; font-size: 1.1rem;">
                    <option value="" disabled selected>-- 請下拉選擇代理商 --</option>
                    ${optionsHtml}
                </select>
                <div class="text-start mt-3 small text-danger">
                    <i class="bi bi-info-circle"></i> 注意：請先確認流水帳金額及總金額是否正確。
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '下一步：檢視流水帳對帳單', 
            confirmButtonColor: '#0d6efd',
            cancelButtonText: '取消',
            preConfirm: () => {
                const id = document.getElementById('swal-settle-agent').value;
                if (!id) {
                    Swal.showValidationMessage('請選擇一個有欠款的代理商以繼續');
                    return false;
                }
                return id;
            }
        });

        if (partnerId) {
            const targetAgent = agentMap[partnerId];
            
            let tableHtml = `
                <div class="table-responsive mt-3 border rounded shadow-sm" style="max-height: 250px; overflow-y: auto;">
                    <table class="table table-sm table-hover text-start align-middle mb-0" style="font-size: 0.85rem;">
                        <thead class="table-light sticky-top">
                            <tr>
                                <th class="ps-2">產生時間</th>
                                <th>貢獻客戶</th>
                                <th class="text-end">原消費</th>
                                <th class="text-end pe-2 text-success">應發分潤</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            targetAgent.items.forEach(item => {
                const dateStr = item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString() : '未知';
                tableHtml += `
                    <tr>
                        <td class="text-muted ps-2">${dateStr}</td>
                        <td class="fw-bold">${item.clientName || '未知'}</td>
                        <td class="text-end text-muted">$${item.amount || 0}</td>
                        <td class="text-end fw-bold text-success pe-2">+$${item.earned || 0}</td>
                    </tr>
                `;
            });
            tableHtml += `</tbody></table></div>`;

            const confirm = await Swal.fire({
                title: `結算對帳單`,
                width: 600, 
                html: `
                    <div class="text-start mb-2">
                        結算對象：<b>${targetAgent.name}</b><br>
                        共計 <b class="text-primary">${targetAgent.items.length}</b> 筆帳單，總金額：<span class="fs-4 text-danger fw-bold ms-1">NT$ ${targetAgent.pending}</span>
                    </div>
                    ${tableHtml}
                    <div class="text-start text-muted mt-3 small">
                        ※ 點擊下方按鈕後，上述 ${targetAgent.items.length} 筆帳單狀態將全數轉為「已發放」。
                    </div>
                `,
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#198754',
                confirmButtonText: '確認金額無誤，執行結清！',
                cancelButtonText: '再等一下'
            });

            if (confirm.isConfirmed) {
                Swal.fire({ title: '帳單狀態更新中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const amount = await API.settlePartnerCommissions(partnerId);
                Swal.fire('🎉 結算成功！', `已成功將 NT$ ${amount} 元標記為「已發放」。`, 'success');
            }
        }
    } catch (e) {
        Swal.fire('系統錯誤', e.message, 'error');
    }
}

export function initAdminModule() {
    Object.assign(window, {
        loadAuditLogs,
        openLogDetail,
        adminAddPoints,
        initAdminTopUp, 
        updatePendingAppCount,
        openApplicationsModal,
        approveApplication,
        deleteApplication, // 👈 🌟 [掛載] 刪除作廢申請單功能
        createNewClient,
        previewEvidenceImage,
        executeSuspension,
        showSettlementWizard 
    });
}
