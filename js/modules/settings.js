/**
 * js/modules/settings.js
 * ------------------------------------------------
 * 負責處理「QA 知識庫」、「通道對接金鑰」、「快速回覆按鈕」以及「儲存大腦設定」。
 * 🌟 [Security] 已重構 saveIntegrationSettings，確保金鑰 100% 走地堡通道，杜絕寫回主檔。
 * 🌟 [Feature] 支援儲存「自訂記憶長度(金魚腦)」、「防刷頻警戒線(Troll-Alert)」與「👑 上帝模式客製化指令」。
 * 🌟 [Feature] 支援「沉浸展示間」與「尊榮去浮水印 (+5% 算力)」開關設定。
 */
import * as API from '../api.js';
import { getVal, setVal } from '../utils.js?v=bypass';

// ==========================================
// 📚 QA 知識庫
// ==========================================
window.qaDataCache = window.qaDataCache || {};

export async function loadQA() {
    const div = document.getElementById('qa-list'); if(!div) return;
    div.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm"></div></div>';
    
    // 每次載入時，順便把搜尋框清空
    const searchInput = document.getElementById('qa-search-filter');
    if (searchInput) searchInput.value = '';

    const snap = await API.getQA(window.currentDbId); 
    div.innerHTML = '';
    if (snap.empty) { div.innerHTML = '<div class="text-center py-5 text-muted"><p class="mt-3 fw-bold fs-5">尚未建立 QA 知識</p></div>'; return; }
    
    snap.forEach(doc => { 
        window.qaDataCache[doc.id] = doc.data(); 
        // 把答案(answer)藏在 span 裡面，讓搜尋框也能搜到答案！
        div.innerHTML += `<div class="list-group-item d-flex justify-content-between align-items-center qa-item-row"><div><strong>Q: ${doc.data().question}</strong><span class="d-none">${doc.data().answer}</span></div><button onclick="window.openQAModal('${doc.id}')" class="btn btn-sm btn-outline-primary">Edit</button></div>`; 
    });
}

// 🦅 [戰區三] 本地即時搜尋過濾 QA (不消耗後端 API)
export function filterQAList(keyword) {
    const listContainer = document.getElementById('qa-list');
    if (!listContainer) return;
    
    const term = keyword.toLowerCase().trim();
    const items = listContainer.getElementsByClassName('qa-item-row');
    
    Array.from(items).forEach(item => {
        // textContent 會把題目和隱藏的答案全部抓出來比對
        const textContext = item.textContent.toLowerCase();
        if (textContext.includes(term)) {
            item.classList.add('d-flex');
            item.classList.remove('d-none');
        } else {
            item.classList.remove('d-flex');
            item.classList.add('d-none');
        }
    });
}

export async function saveQA() { await API.saveQA(getVal('qa-id'), { clientId: window.currentDbId, question: getVal('qa-question'), answer: getVal('qa-answer') }); if(window.qaModal) window.qaModal.hide(); loadQA(); }
export async function deleteQA() { if(confirm("確定刪除？")) { await API.deleteQA(getVal('qa-id')); if(window.qaModal) window.qaModal.hide(); loadQA(); } }
export function openQAModal(id) { if(id) { const d = window.qaDataCache[id]; setVal('qa-id', id); setVal('qa-question', d.question); setVal('qa-answer', d.answer); } else { setVal('qa-id', ""); setVal('qa-question', ""); setVal('qa-answer', ""); } if(window.qaModal) window.qaModal.show(); }

// ==========================================
// 🔌 通道對接與推播設定 (🛡️ 地堡模式重構)
// ==========================================
export function toggleTgSummary(checkbox) { if (checkbox.checked && !window.currentTgChatId) { checkbox.checked = false; Swal.fire('無法啟用', '請先聯繫系統工程師協助綁定您的 Telegram 接收帳號。', 'warning'); } }

export async function saveIntegrationSettings() {
    if (!window.isSuperUser) return;
    
    const secretData = {
        channelAccessToken: getVal('integration-token').trim(),
        channelSecret: getVal('integration-secret').trim(),
        geminiApiKey: getVal('integration-geminikey').trim(),
        lineBotId: getVal('integration-botid').trim()
    };

    if (!secretData.channelAccessToken || !secretData.channelSecret || !secretData.geminiApiKey) {
        return Swal.fire('欄位未齊', '請確保 Token, Secret 與 Gemini Key 皆已填寫。', 'warning');
    }

    try {
        Swal.fire({ title: '安全同步中...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });

        // 1. 處理 Telegram Chat ID (非機密，存入主檔 builder_settings)
        const docSnap = await API.getClientById(window.currentDocId); 
        let currentSettings = docSnap.exists() ? (docSnap.data().builder_settings || {}) : {};
        currentSettings.telegramChatId = getVal('integration-tgid').trim(); 
        window.currentTgChatId = currentSettings.telegramChatId; 
        
        await API.updateClient(window.currentDocId, { builder_settings: currentSettings }); 

        // 2. 🛡️ 處理機密金鑰 (強制寫入金庫，並抹除主檔)
        await API.saveClientSecrets(window.currentDocId, secretData);
        
        Swal.fire('成功', 'Telegram設定與機密金鑰已安全鎖入金庫！', 'success');
        
        // 重新讀取詳情以更新 UI 狀態
        if(window.openClientDetail) window.openClientDetail(window.currentDocId, document.getElementById('detail-title').innerText, window.currentDbId);

    } catch(e) { 
        Swal.fire('錯誤', e.message, 'error'); 
    }
}

// ==========================================
// ⚡ 快速回覆按鈕設定 (鎖定最多 3 組)
// ==========================================
export function renderQuickReplies() {
    const container = document.getElementById('quick-reply-container'); 
    const badge = document.getElementById('qr-count-badge'); 
    const emptyState = document.getElementById('qr-empty-state');
    
    if (!container || !badge) return; 
    
    Array.from(container.children).forEach(child => { 
        if(child.id !== 'qr-empty-state') container.removeChild(child); 
    });
    
    window.tempQuickReplies = window.tempQuickReplies || []; 
    // 🛑 這裡把分母從 5 改成 3
    badge.innerText = `${window.tempQuickReplies.length} / 3`;
    
    if (window.tempQuickReplies.length === 0) { 
        if(emptyState) emptyState.style.display = 'block'; 
    } else {
        if(emptyState) emptyState.style.display = 'none';
        window.tempQuickReplies.forEach((qr, index) => {
            const div = document.createElement('div'); 
            div.className = "row g-2 mb-2 p-2 border rounded bg-white align-items-center shadow-sm position-relative"; 
            div.style.borderLeft = "4px solid #ffc107";
            div.innerHTML = `<div class="col-md-4"><div class="form-floating"><input type="text" class="form-control form-control-sm" id="qr-label-${index}" maxlength="20" value="${qr.label}" onchange="window.updateQR(${index}, 'label', this.value)"><label class="text-muted small">按鈕標題</label></div></div><div class="col-md-7"><div class="form-floating"><input type="text" class="form-control form-control-sm" id="qr-text-${index}" maxlength="300" value="${qr.text}" onchange="window.updateQR(${index}, 'text', this.value)" placeholder="輸入文字或網址"><label class="text-muted small">隱藏指令 / 網址 (http開頭)</label></div></div><div class="col-md-1 text-center"><button type="button" class="btn btn-sm btn-outline-danger border-0" onclick="window.removeQR(${index})"><i class="bi bi-trash-fill fs-5"></i></button></div>`;
            container.appendChild(div);
        });
    }
}

export function addQuickReplyItem() { 
    window.tempQuickReplies = window.tempQuickReplies || []; 
    // 🛑 核心防呆：這裡把 5 改成 3，超過就擋下來
    if (window.tempQuickReplies.length >= 3) {
        // (可選) 您也可以在這裡加個 Swal.fire 提示店家已達上限
        return; 
    }
    window.tempQuickReplies.push({ label: "", text: "" }); 
    renderQuickReplies(); 
}

export function updateQR(index, key, val) { 
    let cleanVal = val.replace(/[<>\\{}[\]"]/g, "").trim(); 
    if (key === 'label') cleanVal = cleanVal.substring(0, 20); 
    if (key === 'text') cleanVal = cleanVal.substring(0, 300); 
    window.tempQuickReplies[index][key] = cleanVal; 
}

export function removeQR(index) { 
    window.tempQuickReplies.splice(index, 1); 
    renderQuickReplies(); 
}

// ==========================================
// 🌟 [新增] 浮水印 UI 綁定輔助函數
// ==========================================
export function initWatermarkUI(settings) {
    const removeWatermarkToggle = document.getElementById('toggleRemoveWatermark');
    const watermarkWarning = document.getElementById('watermarkWarning');
    
    if (removeWatermarkToggle && watermarkWarning) {
        // 載入時依據設定檔打勾，並顯示/隱藏警告
        const isRemoved = settings.remove_watermark === true;
        removeWatermarkToggle.checked = isRemoved;
        watermarkWarning.style.display = isRemoved ? 'block' : 'none';

        // 綁定點擊事件
        removeWatermarkToggle.onchange = function() {
            watermarkWarning.style.display = this.checked ? 'block' : 'none';
        };
    }
}


// ==========================================
// 🧠 儲存 AI 大腦總設定 (極度純淨版 Single Source of Truth)
// ==========================================
export async function saveClientSettings() {
    try {
        if (!window.currentDocId) {
            return Swal.fire('系統錯誤', '遺失專案 ID，請重新整理頁面。', 'error');
        }

        if (typeof window.generateSystemPrompt !== 'function') {
            return Swal.fire('系統錯誤', '找不到大腦生成引擎，請按 Ctrl+F5 強制重新整理。', 'error');
        }

        const docSnap = await API.getClientById(window.currentDocId); 
        let currentSettings = docSnap.exists() ? (docSnap.data().builder_settings || {}) : {};
        
        // 🌟 讀取滑桿數值並轉換為 AI 角色文字，以防舊系統報錯
        const sliderEl = document.getElementById('pb-role-slider');
        const salesWeight = sliderEl ? parseInt(sliderEl.value, 10) : 70; // 若找不到滑塊預設給 70
        
        let roleStr = 'Receptionist';
        if (salesWeight >= 90) roleStr = 'Ultimate Sales Engine';
        else if (salesWeight >= 70) roleStr = 'Top Sales';
        else if (salesWeight >= 50) roleStr = 'Proactive Salesperson';
        else if (salesWeight >= 30) roleStr = 'Balanced Consultant';
        else roleStr = 'Professional Guide';

        // 🎯 統一的設定抽屜：把所有設定乾乾淨淨地打包在這裡
        const newSettings = { 
            ...currentSettings, 
            industry: getVal('pb-industry'), 
            brand: getVal('pb-brand'), 
            brandVibe: getVal('pb-vibe'), 
            commStyle: getVal('pb-style'), 
            
            // 寫入轉換後的角色名稱，並額外儲存滑塊權重
            role: roleStr, 
            role_weight: salesWeight, 

            responseLength: document.querySelector('input[name="pb-length"]:checked')?.value, 
            activeEngines: Array.from(document.querySelectorAll('.pb-engine-check:checked')).map(cb => cb.value), 
            activeRules: Array.from(document.querySelectorAll('.pb-rule-check:checked')).map(cb => cb.value), 
            
            gleSelectedLanguages: Array.from(document.querySelectorAll('.gle-check:checked')).map(cb => cb.value), 
            memoryLength: parseInt(getVal('pb-memory') || '6', 10),
            trollAlertThreshold: parseInt(getVal('pb-troll-alert') || '5', 10),
            
            customPrompt: document.getElementById('pb-custom-prompt') ? document.getElementById('pb-custom-prompt').value.trim() : '',
            super_keywords: document.getElementById('pb-super-keywords') ? document.getElementById('pb-super-keywords').value.trim() : '',
            
            // 🌟 儲存全店沉浸展示間與浮水印開關
            enable_immersive_showroom: document.getElementById('eng-showroom') ? document.getElementById('eng-showroom').checked : true,
            remove_watermark: document.getElementById('toggleRemoveWatermark') ? document.getElementById('toggleRemoveWatermark').checked : false,
            
            stores: window.currentStores, 
            quickReplies: window.tempQuickReplies || [], 
            enable_tg_summary: document.getElementById('eng-tg-summary')?.checked || false 
        };
        
        const promptStr = window.generateSystemPrompt();
        Swal.fire({ title: '大腦同步中...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });
        
        // 🧹 寫入 Firebase
        await API.updateClient(window.currentDocId, { 
            systemPrompt: promptStr, 
            builder_settings: newSettings 
        }); 
        
        Swal.fire('成功', 'AI 大腦設定同步成功！設定已寫入資料庫。', 'success');
    } catch(e) { 
        console.error("Save Settings Failed:", e);
        Swal.fire('寫入失敗', `資料庫錯誤: ${e.message}`, 'error'); 
    }
}

// ==========================================
// 🚀 掛載至 window
// ==========================================
export function initSettingsModule() {
    Object.assign(window, {
        loadQA, saveQA, deleteQA, openQAModal, filterQAList,
        toggleTgSummary, saveIntegrationSettings,
        renderQuickReplies, addQuickReplyItem, updateQR, removeQR,
        saveClientSettings,
        initWatermarkUI // 🌟 記得把這個也掛載出去給 app.js 用
    });
}
