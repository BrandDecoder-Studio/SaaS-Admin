/**
 * js/utils.js
 * 通用工具函式庫 (v20.0.3 - 乾淨重構版)
 */

export function switchView(viewId) {
    const views = ['login-view', 'dashboard-view', 'detail-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.style.display = 'block';
        target.classList.add('active-section');
    }
    window.scrollTo(0, 0);
}

export function toggleLoader(elementId, show) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = show ? 'flex' : 'none';
}

export function formatDate(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp.seconds * 1000).toLocaleDateString();
}

export function formatNumber(num) {
    return num ? Number(num).toLocaleString() : '0';
}

// ==========================================
// 🌟 跨模組 UI 操作輔助工具
// ==========================================
export function getVal(id) { const el = document.getElementById(id); return el ? el.value : ""; }
export function setVal(id, val) { const el = document.getElementById(id); if(el) el.value = val; }
export function setText(id, txt) { const el = document.getElementById(id); if(el) el.innerText = txt; }
export function setRadio(name, val) { const el = document.querySelector(`input[name="${name}"][value="${val}"]`); if(el) el.checked = true; }
export function setCheck(id, checked) { const el = document.getElementById(id); if(el) el.checked = checked; }
