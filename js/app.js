/**
 * js/app.js (v23.3.0 - God Mode Prompt Injection Supported)
 * ------------------------------------------------
 * 1. [Security] 實裝 Secrets Vault 機密金庫讀取邏輯。
 * 2. [UX] 修正一般管理員權限判定：金庫時代，以 lineBotId 存在與否判斷建置狀態。
 * 3. [Feature] 🌟 支援讀取並渲染「自訂記憶長度(金魚腦)」與「防刷頻警戒線(Troll-Alert)」設定。
 * 4. [God Mode] 👑 實裝 Super Admin 專屬客製化 Prompt 介面權限控制。
 * 5. [Feature] 💧 支援「沉浸展示間」與「尊榮去浮水印」介面狀態讀取與防呆。
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth } from "./config.js"; 
import { checkSuperAdmin } from "./auth.js";
import { switchView, toggleLoader, formatNumber, setVal, setText, setCheck, setRadio } from "./utils.js?v=bypass";
import * as API from "./api.js";

import { initProductsModule } from "./modules/products.js?v=bypass";
import { initCrmModule } from "./modules/crm.js?v=bypass"; 
import { initPromptBuilderModule } from "./modules/prompt-builder.js?v=bypass"; 
import { initWarRoomModule } from "./modules/war-room.js?v=bypass"; 
import { initAdminModule } from "./modules/admin.js?v=bypass"; 
import { initSettingsModule } from "./modules/settings.js?v=bypass";

window.currentDocId = null;
window.currentDbId = null;
window.currentStores = [];
window.tempQuickReplies = [];
window.currentTgChatId = ""; 

window.checkAgreementAndLogin = async () => {
    const checkbox = document.getElementById('legal-agreement-check');
    if (!checkbox || !checkbox.checked) {
        Swal.fire({ title: '尚未同意服務條款', text: '請先勾選同意條款後再登入。', icon: 'warning', confirmButtonColor: '#d4af37' });
        if(checkbox) { checkbox.parentElement.classList.add('border-danger', 'bg-danger', 'bg-opacity-10'); setTimeout(() => checkbox.parentElement.classList.remove('border-danger', 'bg-danger', 'bg-opacity-10'), 1500); }
        return;
    }
    try { const authMod = await import("./auth.js"); authMod.handleLogin(); } catch(e) { console.error(e); }
};

window.handleLogout = async () => { try { const authMod = await import("./auth.js"); authMod.handleLogout(); } catch(e){ console.error(e); } };

window.onload = () => {
    try { initProductsModule(); } catch(e) { console.warn(e); }
    try { initCrmModule(); } catch(e) { console.warn(e); }
    try { initPromptBuilderModule(); } catch(e) { console.warn(e); }
    try { initWarRoomModule(); } catch(e) { console.warn(e); }
    try { initAdminModule(); } catch(e) { console.warn(e); }
    try { initSettingsModule(); } catch(e) { console.warn(e); }

    try { window.memberModal = new bootstrap.Modal(document.getElementById('memberModal')); } catch(e){}
    try { window.qaModal = new bootstrap.Modal(document.getElementById('qaModal')); } catch(e){}
    try { window.productModal = new bootstrap.Modal(document.getElementById('productModal')); } catch(e){}
    try { window.logDetailModal = new bootstrap.Modal(document.getElementById('logDetailModal')); } catch(e){}
    try { window.applicationsModal = new bootstrap.Modal(document.getElementById('applicationsModal')); } catch(e){} 
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.map(function (el) { return new bootstrap.Popover(el, { trigger: 'focus hover' }); });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            setText('user-display', user.email);
            if (document.getElementById('btn-logout')) document.getElementById('btn-logout').style.display = 'block';

            const isSuper = await checkSuperAdmin(user.email);
            window.isSuperUser = isSuper;

            const roleBadge = document.getElementById('role-badge');
            if (roleBadge) roleBadge.style.display = 'none';
            ['admin-topup-panel', 'btn-create-client', 'btn-view-applications', 'btn-settle-agent'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            if (isSuper) {
                if (roleBadge) roleBadge.style.display = 'inline-block';
                if (document.getElementById('admin-topup-panel')) document.getElementById('admin-topup-panel').style.display = 'block';
                if (document.getElementById('btn-create-client')) document.getElementById('btn-create-client').style.display = 'inline-block';
                if (document.getElementById('btn-view-applications')) document.getElementById('btn-view-applications').style.display = 'inline-block';
                if (document.getElementById('btn-settle-agent')) document.getElementById('btn-settle-agent').style.display = 'inline-block';

                window.showDashboard();
                window.loadClientsForSuperAdmin();
                if (window.updatePendingAppCount) window.updatePendingAppCount();
                return;
            }

            const snap = await API.getClientsByEmail(user.email);
            if (!snap.empty) {
                const doc = snap.docs[0];
                window.openClientDetail(doc.id, doc.data().name, doc.data().dbId || doc.id);
                return;
            }

            setText('no-access-email', user.email);
            switchView('no-access-view');
        } else {
            window.isSuperUser = false;
            switchView('login-view');
            if (document.getElementById('btn-logout')) document.getElementById('btn-logout').style.display = 'none';
        }
    });
};

window.showDashboard = async () => { switchView('dashboard-view'); if (window.isSuperUser) await window.loadClientsForSuperAdmin(); };

window.loadClientsForSuperAdmin = async () => { 
    toggleLoader('loader-list', true); 
    renderClientList(await API.getAllClients()); 
}

function renderClientList(snap) {
    toggleLoader('loader-list', false); 
    const list = document.getElementById('client-list'); 
    if(!list) return; 
    list.innerHTML = "";
    if (snap.empty) { list.innerHTML = '<div class="col-12 text-center text-muted py-5">尚無專案</div>'; return; }
    
    snap.forEach(d => { 
        const data = d.data(); 
        
        // 🌟 [UI 強化] 判斷狀態並產生對應的右上角 Badge
        const status = data.status || 'ACTIVE';
        let statusBadge = '';
        if (status === 'SUSPENDED') {
            statusBadge = `<span class="badge bg-danger position-absolute top-0 end-0 m-3 shadow-sm"><i class="bi bi-x-circle-fill"></i> 已停權</span>`;
        } else {
            statusBadge = `<span class="badge bg-success bg-opacity-75 position-absolute top-0 end-0 m-3 shadow-sm"><i class="bi bi-play-circle-fill"></i> 運行中</span>`;
        }

        // 注意：在 card 上加了 position-relative，讓 badge 可以絕對定位在右上角
        // 標題加了 w-75 text-truncate 避免名字太長跟標籤重疊
        list.innerHTML += `
        <div class="col-md-4 mb-3">
            <div class="card card-hover h-100 p-3 shadow-sm border-0 position-relative" style="cursor: pointer;" onclick="window.openClientDetail('${d.id}', '${data.name}', '${data.dbId||d.id}')">
                ${statusBadge}
                <h5 class="fw-bold mb-1 text-primary w-75 text-truncate">${data.name || '未命名專案'}</h5>
                <p class="text-muted small mb-0 text-truncate">${data.adminEmail || 'No Email'}</p>
            </div>
        </div>`; 
    });
}

// ==========================================
// 🛡️ 核心：開啟客戶詳情 (含金庫讀取與權限隔離)
// ==========================================
window.openClientDetail = async (id, name, dbIdFromList) => {
    window.currentDocId = id; window.currentDbId = dbIdFromList; API.setCurrentDbId(window.currentDbId);
    setText('detail-title', name); switchView('detail-view');
    
    const backBtn = document.getElementById('btn-back-list'); 
    if (backBtn) { if (window.isSuperUser) { backBtn.classList.remove('d-none'); backBtn.classList.add('d-inline-flex'); } else { backBtn.classList.remove('d-inline-flex'); backBtn.classList.add('d-none'); } }
    
    const now = new Date(); const firstDay = new Date(now.getFullYear(), now.getMonth(), 1); firstDay.setHours(0, 0, 0, 0); 
    const toLocalISOString = (date) => { const pad = (num) => (num < 10 ? '0' : '') + num; return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()); };
    setVal('log-date-start', toLocalISOString(firstDay)); setVal('log-date-end', toLocalISOString(now));
    
    const billingTab = document.querySelector('a[href="#tab-billing"]'); 
    if (billingTab) { new bootstrap.Tab(billingTab).show(); if(window.loadBillingStats) window.loadBillingStats(); }
    
    const docSnap = await API.getClientById(id);
    if (docSnap.exists()) {
        const d = docSnap.data(); 

        // 🟢 新增 1：將當前客戶資料存入全域變數，供狀態切換按鈕讀取
        window.currentClientData = d; 
        
        // 🟢 新增 2：打開戰情室瞬間，立刻根據 status 初始化右上角的「停權/運行」紅綠按鈕 UI
        if (window.updateStatusButtonUI) window.updateStatusButtonUI(d.status);
        
        setText('top-badge-points', formatNumber(d.balance_points || 0));
        setText('integration-docid', id); setVal('integration-webhook', `https://brand-decoder-bot-217800246535.asia-east1.run.app?cid=${id}`);
        
        let rawToken = ''; 
        let rawSecret = '';
        let rawGeminiKey = '';
        let isFullyConfigured = false; // 🛡️ 金庫時代的判斷旗標

        // 🌟 [Secrets Vault] 超級管理員優先從金庫撈取
        if (window.isSuperUser) {
            try {
                const secretSnap = await API.getClientSecrets(id);
                if (secretSnap.exists()) {
                    const s = secretSnap.data();
                    rawToken = s.channelAccessToken || '';
                    rawSecret = s.channelSecret || '';
                    rawGeminiKey = s.geminiApiKey || '';
                    if (rawToken && rawSecret && rawGeminiKey) isFullyConfigured = true;
                }
            } catch(e) { console.warn("Secrets Vault access denied or not found."); }
        } else {
            // 🛡️ 一般管理員看不到金鑰，只能透過大廳的 lineBotId 來判斷是否已開通
            if (d.lineBotId && d.lineBotId.trim() !== '') {
                isFullyConfigured = true;
            }
        }

        const roleBadge = document.getElementById('integration-role-badge'); 
        const adminView = document.getElementById('integration-admin-view'); 
        const userView = document.getElementById('integration-user-view');
        
        // 👑 抓取上帝模式區塊
        const godModeBlock = document.getElementById('super-admin-prompt-block'); 
        
        if (window.isSuperUser) {
            if(roleBadge) { roleBadge.innerText = "管理員編輯模式"; roleBadge.className = "badge bg-warning text-dark"; }
            if(adminView) adminView.style.display = "block"; if(userView) userView.style.display = "none";
            if(godModeBlock) godModeBlock.style.display = "block"; // 👑 顯示上帝模式輸入框
            
            setVal('integration-token', rawToken); 
            setVal('integration-secret', rawSecret); 
            setVal('integration-geminikey', rawGeminiKey); 
            setVal('integration-botid', d.lineBotId || '');
        } else {
            if(adminView) adminView.style.display = "none"; 
            if(userView) userView.style.display = "block";
            if(godModeBlock) godModeBlock.style.display = "none"; // 🙈 一般客戶隱藏上帝模式
            
            if(roleBadge) { 
                roleBadge.innerText = isFullyConfigured ? "系統安全防護中" : "建置中"; 
                roleBadge.className = isFullyConfigured ? "badge bg-success" : "badge bg-danger"; 
            }
            
            const successView = document.getElementById('integration-status-success');
            const errorView = document.getElementById('integration-status-error');
            if (isFullyConfigured) {
                if (successView) successView.style.display = "block";
                if (errorView) errorView.style.display = "none";
            } else {
                if (successView) successView.style.display = "none";
                if (errorView) errorView.style.display = "block";
            }
        }

        if (d.builder_settings) {
            const s = d.builder_settings;
            setVal('pb-industry', s.industry || 'Retail'); 
            setVal('pb-brand', s.brand || d.name || ''); 
            setVal('pb-vibe', s.brandVibe || 'Premium'); 
            setVal('pb-style', s.commStyle || 'Professional'); 
            setRadio('pb-length', s.responseLength || 'Standard');
            
            // 🌟 [新增] 讀取滑桿權重並更新 UI (包含光譜漸層顏色)
            const savedWeight = s.role_weight !== undefined ? s.role_weight : 70;
            const roleSlider = document.getElementById('pb-role-slider');
            const roleDisplay = document.getElementById('pb-role-display');
            
            // 🎨 顏色計算函數
            const getSpectrumColor = (val) => {
                if (val <= 20) return '#007bff'; // 藍
                if (val <= 40) return '#4b82d5'; // 淡藍
                if (val <= 60) return '#6f42c1'; // 紫
                if (val <= 80) return '#e83e8c'; // 粉
                return '#dc3545';                // 紅
            };

            if (roleSlider) roleSlider.value = savedWeight;
            if (roleDisplay) {
                roleDisplay.innerText = `銷售 ${savedWeight}% | 接待 ${100 - savedWeight}%`;
                // 動態染上目前的設定顏色
                roleDisplay.style.backgroundColor = getSpectrumColor(savedWeight);
                roleDisplay.style.borderColor = getSpectrumColor(savedWeight);
            }

            // 🌟 讀取金魚腦與防刷頻設定
            setVal('pb-memory', s.memoryLength !== undefined ? s.memoryLength : '6');
            setVal('pb-troll-alert', s.trollAlertThreshold !== undefined ? s.trollAlertThreshold : '5');
            
            // 👑 讀取客製化上帝指令
            setVal('pb-custom-prompt', s.customPrompt || ''); 
            // 🌟 讀取 Mode 2 產業專屬字庫
            setVal('pb-super-keywords', s.super_keywords || '');
            
            // 🌟 讀取全店沉浸展示間開關 (預設給 true，避免舊客戶功能消失)
            setCheck('eng-showroom', s.enable_immersive_showroom !== false);
            
            // 💧 [新增] 初始化浮水印 UI 狀態 (呼叫 settings.js 的函數)
            if (window.initWatermarkUI) window.initWatermarkUI(s);

            window.currentTgChatId = s.telegramChatId || ''; setVal('integration-tgid', window.currentTgChatId); setCheck('eng-tg-summary', s.enable_tg_summary || false);
            const savedRules = s.activeRules || []; setCheck('rule-strict-qa', savedRules.includes('StrictQA')); setCheck('rule-no-bargain', savedRules.includes('NoBargain')); setCheck('rule-no-medical', savedRules.includes('NoMedical'));
            const savedEngines = s.activeEngines || ['Sales', 'O2O', 'Service']; setCheck('eng-sales', savedEngines.includes('Sales')); setCheck('eng-o2o', savedEngines.includes('O2O')); setCheck('eng-service', savedEngines.includes('Service'));
            const savedLangs = s.gleSelectedLanguages || ['zh-TW']; document.querySelectorAll('.gle-check').forEach(cb => { cb.checked = savedLangs.includes(cb.value); });
            window.currentStores = s.stores || []; if(window.renderStoreList) window.renderStoreList(); 
            window.tempQuickReplies = s.quickReplies || []; if(window.renderQuickReplies) window.renderQuickReplies();
            
        } else {
            // 🌟 若無設定檔時的預設防呆
            setVal('pb-memory', '6');
            setVal('pb-troll-alert', '5');
            setVal('pb-custom-prompt', '');
            setVal('pb-super-keywords', '');
            setCheck('eng-showroom', true);
            
            // 💧 [新增] 無設定檔時，預設關閉尊榮去浮水印
            if (window.initWatermarkUI) window.initWatermarkUI({ remove_watermark: false });
            
            window.currentTgChatId = ''; setVal('integration-tgid', ''); setCheck('eng-tg-summary', false); window.currentStores = []; if(window.renderStoreList) window.renderStoreList();
        }
        setTimeout(() => { if(window.initGoogleMapsAutocomplete) window.initGoogleMapsAutocomplete(); }, 500);
    }
};

// 👑 上帝模式快捷按鈕輔助函數 (自動換行加入游標處)
window.insertPromptTemplate = function(text) {
    const textarea = document.getElementById('pb-custom-prompt');
    if(textarea) {
        textarea.value = textarea.value + (textarea.value ? '\n\n' : '') + text;
        if(window.updatePromptPreview) window.updatePromptPreview();
    }
};

// ============================================================================
// 🔴 [P1 功能] 戰情中心 UI 修正：專案狀態切換與按鈕紅綠聯動邏輯
// ============================================================================

/**
 * 專責處理按鈕 UI 紅綠變換的函數
 */
window.updateStatusButtonUI = function(status) {
    const btn = document.getElementById('admin-status-btn');
    if (!btn) return;

    // 若無狀態或狀態為 ACTIVE，顯示綠色運行中
    if (!status || status === 'ACTIVE') {
        btn.className = 'btn btn-success w-100 fw-bold shadow-sm';
        btn.innerHTML = '<i class="bi bi-power"></i> 🟢 運行中 (點擊停權)';
    } else {
        // 其他狀況 (例如 SUSPENDED) 顯示紅色已停權
        btn.className = 'btn btn-danger w-100 fw-bold shadow-sm';
        btn.innerHTML = '<i class="bi bi-power"></i> 🔴 已停權 (點擊恢復)';
    }
};

/**
 * 點擊按鈕時觸發的狀態切換與資料庫更新 (呼叫存證彈窗)
 */
window.toggleClientStatus = async function() {
    if (!window.currentDocId || !window.currentClientData) {
        Swal.fire('錯誤', '找不到當前客戶資料，請重新整理頁面。', 'error');
        return;
    }

    const currentStatus = window.currentClientData.status || 'ACTIVE';

    if (currentStatus === 'ACTIVE') {
        // 🔴 準備停權：清空欄位並打開 Modal (不直接呼叫 API，交給 Modal 的按鈕去處理)
        document.getElementById('suspend-reason').value = '違反 AUP 政策 (詐騙/黃賭毒)';
        document.getElementById('suspend-memo').value = '';
        document.getElementById('suspend-evidence-file').value = '';
        document.getElementById('suspend-preview-container').style.display = 'none';
        document.getElementById('suspend-preview-img').src = '';

        const modal = new bootstrap.Modal(document.getElementById('suspensionModal'));
        modal.show();
    } else {
        // 🟢 準備恢復：因為是解鎖，不需要存證，直接彈窗確認即可
        const result = await Swal.fire({
            title: '確定要解除停權 (恢復) 此專案嗎？',
            text: '恢復後，該客戶的 AI 機器人將重新開始接客。',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#198754',
            cancelButtonText: '取消',
            confirmButtonText: '是的，我要恢復'
        });

        if (result.isConfirmed) {
            try {
                Swal.fire({ title: '系統恢復中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                // 恢復時，把之前停權的原因和截圖網址清空，保持資料乾淨
                await API.updateClient(
                    window.currentDocId, 
                    { status: 'ACTIVE', suspend_reason: null, suspend_memo: null, evidence_url: null }, 
                    'CLIENT_ACTIVATED', 
                    '🟢 恢復專案 (重新上線)'
                );
                
                window.currentClientData.status = 'ACTIVE';
                window.updateStatusButtonUI('ACTIVE');
                Swal.fire('成功', '該專案已成功恢復上線！', 'success');
            } catch (error) {
                console.error("[Status Update Error]:", error);
                Swal.fire('權限錯誤', '狀態更新失敗，請檢查網路或權限。', 'error');
            }
        }
    }
};

export { };
