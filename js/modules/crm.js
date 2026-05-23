
/**
 * js/modules/crm.js
 * ------------------------------------------------
 * 負責處理「客戶關係管理 (CRM)」與「商機雷達 (Leads)」的所有前端邏輯。
 */
import * as API from '../api.js';
import { toggleLoader, getVal, setVal } from '../utils.js?v=bypass';

// ==========================================
// 🚩 商機雷達 (Leads)
// ==========================================

export async function loadLeads() {
    toggleLoader('loader-leads', true);
    const status = getVal('filter-lead-status') || 'new';
    const snap = await API.getLeads(window.currentDbId, status);
    toggleLoader('loader-leads', false);
    
    const div = document.getElementById('lead-list'); 
    if(!div) return; 
    div.innerHTML = '';
    
    if (snap.empty) { 
        div.innerHTML = '<div class="col-12 text-center text-muted py-5"><i class="bi bi-inbox display-3 text-secondary opacity-25"></i><p class="mt-3 fw-bold fs-5">暫無商機名單</p></div>'; 
        return; 
    }
    
    snap.forEach(doc => {
        const l = doc.data();
        const badgeClass = l.status === 'done' ? 'border-primary' : (l.status === 'processing' ? 'border-warning' : 'border-success');
        
        let timeString = '時間未知';
        if (l.createdAt && l.createdAt.seconds) {
            const dateObj = new Date(l.createdAt.seconds * 1000);
            timeString = dateObj.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
        
        const selectHTML = `<select class="form-select form-select-sm" style="width:auto; display:inline-block;" onchange="window.updateLeadStatus('${doc.id}', this.value)">
                                <option value="new" ${l.status==='new'?'selected':''}>未處理</option>
                                <option value="processing" ${l.status==='processing'?'selected':''}>處理中</option>
                                <option value="done" ${l.status==='done'?'selected':''}>已完成</option>
                            </select>`;
        
        div.innerHTML += `
            <div class="col-md-6">
                <div class="card p-3 shadow-sm border-start border-4 ${badgeClass} h-100 position-relative">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="d-flex align-items-center">
                            <img src="${l.pictureUrl || 'https://via.placeholder.com/30'}" class="rounded-circle me-2" style="width:30px; height:30px; border: 1px solid #eee;">
                            <strong>${l.user_name || l.displayName || '未知訪客'}</strong>
                        </div>
                        <span class="badge bg-light text-secondary border fw-normal" style="font-size: 0.7rem;"><i class="bi bi-clock"></i> ${timeString}</span>
                    </div>
                    <p class="mb-1 small text-muted">${l.message || '客戶留下了聯絡資訊'}</p>
                    ${l.contactInfo ? `<p class="mb-3 small text-primary fw-bold fs-6"><i class="bi bi-person-lines-fill me-1"></i> ${l.contactInfo}</p>` : ''}
                    <div class="mt-auto text-end border-top pt-2">
                        ${selectHTML}
                    </div>
                </div>
            </div>`;
    });
}

export async function updateLeadStatus(id, status) { 
    await API.updateLeadStatus(id, status); 
    loadLeads(); 
}

// ==========================================
// 👤 客戶關係管理 (Members & Funnel State)
// ==========================================

export async function loadMembers() {
    toggleLoader('loader-members', true);
    const snap = await API.getMembers(window.currentDbId);
    toggleLoader('loader-members', false);
    
    const div = document.getElementById('member-list'); 
    if(!div) return; 
    div.innerHTML = '';
    
    if (snap.empty) { 
        div.innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-people display-3 text-secondary opacity-25"></i><p class="mt-3 fw-bold fs-5">尚無 CRM 客戶名單</p></div>'; 
        return; 
    }
    
    window.memberDataCache = window.memberDataCache || {};

    snap.forEach(doc => {
        const m = doc.data();
        const tierBadge = m.tier === 'VIP' ? '<span class="badge bg-warning text-dark ms-1 shadow-sm">VIP</span>' : '<span class="badge bg-light text-dark border ms-1">一般</span>';
        const note = m.note ? `<div class="small text-muted mt-1 mb-1"><i class="bi bi-chat-left-text me-1"></i>${m.note}</div>` : '';
        const userId = doc.id;
        const copyIdBtn = `<span class="badge bg-light text-secondary border mt-1" style="cursor:pointer;" onclick="navigator.clipboard.writeText('${userId}'); Swal.fire({title:'已複製 LINE ID', icon:'success', timer:1000, showConfirmButton:false});" title="點擊複製"><i class="bi bi-clipboard"></i> 複製 ID</span>`;

        // 🌟 漏斗狀態視覺化 (Funnel State Badges)
        let funnelHTML = '';
        if (m.funnel_state) {
            const funnelItems = [];
            for (const [key, state] of Object.entries(m.funnel_state)) {
                if (state.name) {
                    funnelItems.push({ ...state, key });
                }
            }

            if (funnelItems.length > 0) {
                // 依照最後曝光時間排序 (新的在前面)
                funnelItems.sort((a, b) => b.last_impression_at - a.last_impression_at);
                
                let badges = funnelItems.map(item => {
                    const shortName = item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name;
                    if (item.lead_submitted) {
                        return `<span class="badge bg-success shadow-sm me-1 mb-1" title="已結單轉換"><i class="bi bi-check-circle-fill"></i> 已結單: ${shortName}</span>`;
                    } else if (item.clicked) {
                        return `<span class="badge bg-warning text-dark shadow-sm me-1 mb-1" title="點擊卡片，高潛力！"><i class="bi bi-hand-index-thumb"></i> 有興趣: ${shortName}</span>`;
                    } else {
                        return `<span class="badge bg-light text-secondary border me-1 mb-1" title="僅瀏覽卡片"><i class="bi bi-eye"></i> 瀏覽過: ${shortName}</span>`;
                    }
                }).join('');

                funnelHTML = `
                    <div class="mt-2 pt-2 border-top border-dashed">
                        <div class="small fw-bold text-muted mb-1"><i class="bi bi-funnel-fill"></i> 商機熱度</div>
                        ${badges}
                    </div>
                `;
            }
        }

        div.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center py-2">
                <div class="d-flex align-items-start w-100">
                    <img src="${m.pictureUrl || 'https://via.placeholder.com/40'}" class="rounded-circle me-3 border mt-1" style="width:40px; height:40px; object-fit: cover;">
                    <div class="flex-grow-1">
                        <div class="d-flex justify-content-between align-items-center">
                            <div><span class="fw-bold">${m.nickname || '匿名用戶'}</span>${tierBadge}</div>
                            <button class="btn btn-sm btn-outline-secondary" onclick="window.openMemberModal('${doc.id}')">管理</button>
                        </div>
                        ${copyIdBtn}
                        ${note}
                        ${funnelHTML} 
                    </div>
                </div>
            </div>
        `;
        window.memberDataCache[doc.id] = m;
    });
}

export function openMemberModal(id) { 
    const m = window.memberDataCache[id]; 
    setVal('member-id', id); 
    setVal('member-nick', m.nickname || ''); 
    setVal('member-tier', m.tier || 'Normal'); 
    setVal('member-note', m.note || ''); 

    // 🌟 [新增] 讀取 AI 接管狀態
    const manualToggle = document.getElementById('member-manual-mode');
    if (manualToggle) {
        manualToggle.checked = m.is_manual_mode === true;
    }

    if(window.memberModal) window.memberModal.show(); 
}

export async function saveMember() { 
    // 🌟 [新增] 抓取 AI 接管狀態
    const manualToggle = document.getElementById('member-manual-mode');
    const isManual = manualToggle ? manualToggle.checked : false;

    // 將狀態一起寫入資料庫
    await API.updateMember(getVal('member-id'), { 
        tier: getVal('member-tier'), 
        note: getVal('member-note'),
        is_manual_mode: isManual  // 👈 這裡把開關狀態傳給後端
    }); 

    if(window.memberModal) window.memberModal.hide(); 
    loadMembers(); 
}

// ==========================================
// 🚀 核心：將需要給 HTML onClick 呼叫的函數掛載到 window
// ==========================================
export function initCrmModule() {
    Object.assign(window, {
        loadLeads,
        updateLeadStatus,
        loadMembers,
        openMemberModal,
        saveMember
    });
}
