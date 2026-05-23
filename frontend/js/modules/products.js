/**
 * js/modules/products.js
 * ------------------------------------------------
 * 負責處理「商品庫 (Products)」、「實體門市 (O2O)」與「分類管理 (Categories)」的前端邏輯。
 */
import * as API from '../api.js';
import { toggleLoader, getVal, setVal } from '../utils.js?v=bypass'; 

let tempTags = []; 
let tempGeo = { lat: null, lng: null };

// 🌟 [海關大腦與鋼印追蹤變數]
let tempSystemRoute = "VTO_PERSON"; 
let lastAuditedImgUrl = ""; 
let hasValidAuditRecord = false; 
let lockedAiTags = []; 

// 🌟 [分類快取與狀態]
window.catDataCache = { main: [], sub: {} };
let currentSelectedMainCatId = null;

// ==========================================
// 🚀 1. 實體門市 (O2O) 邏輯
// ==========================================
export function initGoogleMapsAutocomplete() {
    const input = document.getElementById("store-search-input");
    if (!input || input.getAttribute('data-map-bound')) return;
    
    const options = { 
        componentRestrictions: { country: "tw" }, 
        fields: ["formatted_address", "geometry", "name", "url"], 
        types: ["establishment", "geocode"] 
    };
    const autocomplete = new google.maps.places.Autocomplete(input, options);
    input.setAttribute('data-map-bound', 'true');
    
    let isPlaceSelected = false;
    
    autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) { 
            isPlaceSelected = false; 
            return Swal.fire('提示', '請務必點選下拉選單中的地點', 'info'); 
        }
        if (place.geometry.location) { 
            tempGeo = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }; 
        }
        isPlaceSelected = true; 
        setVal('store-name', place.name); 
        setVal('store-display-addr', place.formatted_address.replace(/^\d+台灣/, '').trim()); 
        setVal('store-map-link', place.url); 
        input.value = place.name;
    });
    
    input.addEventListener('input', () => { 
        isPlaceSelected = false; 
        setVal('store-display-addr', ''); 
    });
    
    input.addEventListener('blur', () => { 
        setTimeout(() => { 
            if (!isPlaceSelected && !getVal('store-display-addr')) input.value = ''; 
        }, 300); 
    });
}

export function renderStoreList() {
    const div = document.getElementById('store-list-container'); 
    if(!div) return;
    
    if (!window.currentStores || window.currentStores.length === 0) {
        div.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="bi bi-geo-alt display-6 text-secondary opacity-50 d-block mb-2"></i>
                <span class="small fw-bold">尚未設定任何實體門市</span>
            </div>`; 
        return;
    }
    
    div.innerHTML = window.currentStores.map((s, i) => `
        <div class="list-group-item d-flex justify-content-between align-items-center py-1 small">
            <span><i class="bi bi-geo-alt"></i> ${s.name}</span>
            <button class="btn btn-sm text-danger" onclick="window.removeStoreItem(${i})">x</button>
        </div>`).join('');
}

export function addStoreItem() {
    const name = getVal('store-name'); 
    const addr = getVal('store-display-addr'); 
    const link = getVal('store-map-link');
    
    if(!addr || !link) return Swal.fire('操作錯誤', '請透過搜尋框選擇正確的 Google 地標', 'warning');
    
    if (!window.currentStores) window.currentStores = [];
    window.currentStores.push({ name, displayAddr: addr, mapLink: link, lat: tempGeo.lat, lng: tempGeo.lng });
    
    tempGeo = { lat: null, lng: null }; 
    setVal('store-search-input', ''); 
    setVal('store-display-addr', ''); 
    renderStoreList(); 
    if(window.updatePromptPreview) window.updatePromptPreview();
}

export function removeStoreItem(idx) { 
    if(window.currentStores) window.currentStores.splice(idx, 1); 
    renderStoreList(); 
    if(window.updatePromptPreview) window.updatePromptPreview(); 
}

// ==========================================
// 🚀 2. 分類管理引擎 (禁刪令 + 焦點修復版)
// ==========================================

export async function loadCategories(forceRefresh = false) {
    if (!forceRefresh && window.catDataCache.main.length > 0) return;
    const snap = await API.getCategories(window.currentDbId);
    window.catDataCache = { main: [], sub: {} };
    
    snap.forEach(doc => {
        const cat = { id: doc.id, ...doc.data() };
        if (cat.parent_id) {
            if (!window.catDataCache.sub[cat.parent_id]) window.catDataCache.sub[cat.parent_id] = [];
            window.catDataCache.sub[cat.parent_id].push(cat);
        } else {
            window.catDataCache.main.push(cat);
        }
    });

    window.catDataCache.main.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    for (let key in window.catDataCache.sub) {
        window.catDataCache.sub[key].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
}

export async function openCategoryModal() {
    toggleLoader('loader-products', true);
    await loadCategories(true);
    toggleLoader('loader-products', false);
    
    currentSelectedMainCatId = null;
    renderMainCategories();
    renderSubCategories();
    
    const modalEl = document.getElementById('categoryModal');
    if (modalEl) { bootstrap.Modal.getOrCreateInstance(modalEl).show(); }
}

// 🌟 渲染大分類 (加入 SaaS 上下架開關、商品數量與視覺防呆)
function renderMainCategories() {
    const list = document.getElementById('main-cat-list');
    if (!list) return;
    
    if (window.catDataCache.main.length === 0) {
        list.innerHTML = '<div class="text-center p-3 text-muted small">尚未建立大分類</div>';
        return;
    }

    list.innerHTML = window.catDataCache.main.map(cat => {
        const isActive = cat.is_active !== false && cat.listing !== false;
        
        // 🌟 總監加碼：從前端快取瞬間計算該分類底下的商品數 (零延遲、零花費)
        let prodCount = 0;
        if (window.prodDataCache) {
            prodCount = Object.values(window.prodDataCache).filter(p => p.main_category_id === cat.id).length;
        }
        
        return `
        <div class="list-group-item d-flex justify-content-between align-items-center cat-item ${currentSelectedMainCatId === cat.id ? 'active' : ''}" 
             onclick="window.selectMainCategory('${cat.id}')">
            <div class="d-flex align-items-center">
                <div class="form-check form-switch me-2 mb-0">
                    <input class="form-check-input" type="checkbox" ${isActive ? 'checked' : ''} 
                           onclick="event.stopPropagation(); window.toggleCategoryStatus('${cat.id}', ${isActive})"
                           style="cursor: pointer;">
                </div>
                <span class="${isActive ? 'fw-bold' : 'text-muted text-decoration-line-through'}">
                    ${cat.name} <span class="badge bg-light text-secondary border ms-1">${prodCount}</span>
                </span>
                ${isActive ? '' : '<span class="badge bg-secondary ms-2" style="font-size:0.65rem;">已下架</span>'}
            </div>
            <button class="btn btn-sm text-primary py-0" onclick="event.stopPropagation(); window.editCategoryName('${cat.id}', '${cat.name}')">
                <i class="bi bi-pencil-square"></i>
            </button>
        </div>
        `;
    }).join('');
}

export function selectMainCategory(id) {
    currentSelectedMainCatId = id;
    renderMainCategories(); 
    renderSubCategories();
}

// 🌟 渲染小分類 (加入 SaaS 上下架開關、商品數量與視覺防呆)
function renderSubCategories() {
    const list = document.getElementById('sub-cat-list');
    if (!list) return;
    
    if (!currentSelectedMainCatId) {
        list.innerHTML = '<div class="text-center p-4 text-muted small"><i class="bi bi-hand-index me-1"></i> 請先選擇左側大分類</div>';
        return;
    }

    const subCats = window.catDataCache.sub[currentSelectedMainCatId] || [];
    
    if (subCats.length === 0) {
        list.innerHTML = '<div class="text-center p-3 text-muted small">此分類下無子分類</div>';
        return;
    }

    list.innerHTML = subCats.map(cat => {
        const isActive = cat.is_active !== false && cat.listing !== false;
        
        // 🌟 總監加碼：計算小分類商品數
        let prodCount = 0;
        if (window.prodDataCache) {
            prodCount = Object.values(window.prodDataCache).filter(p => p.sub_category_id === cat.id).length;
        }

        return `
        <div class="list-group-item d-flex justify-content-between align-items-center bg-light">
            <div class="d-flex align-items-center">
                <div class="form-check form-switch me-2 mb-0">
                    <input class="form-check-input" type="checkbox" ${isActive ? 'checked' : ''} 
                           onclick="window.toggleCategoryStatus('${cat.id}', ${isActive})"
                           style="cursor: pointer;">
                </div>
                <span class="small ${isActive ? 'text-dark fw-bold' : 'text-muted text-decoration-line-through'}">
                    ${cat.name} <span class="badge bg-white text-secondary border ms-1">${prodCount}</span>
                </span>
            </div>
            <button class="btn btn-sm text-primary py-0" onclick="window.editCategoryName('${cat.id}', '${cat.name}')">
                <i class="bi bi-pencil-square"></i>
            </button>
        </div>
        `;
    }).join('');
}

// 🌟 修改分類名稱 (取代刪除)
export async function editCategoryName(id, oldName) {
    const { value: newName } = await Swal.fire({
        title: '修改分類名稱',
        input: 'text',
        inputValue: oldName,
        target: document.getElementById('categoryModal'), // 修正 Bootstrap 焦點衝突
        didOpen: () => { setTimeout(() => Swal.getInput().focus(), 100); }, // 強制游標進入
        showCancelButton: true,
        inputValidator: (value) => {
            if (!value) return '名稱不能為空！';
            if (value.length > 8) return '名稱過長，建議 8 字以內';
        }
    });

    if (newName && newName !== oldName) {
        await saveCategoryData({ name: newName }, id);
    }
}

// 新增大分類 (限制 9 組 + 焦點修復)
export async function addMainCategory() {
    if (window.catDataCache.main.length >= 9) {
        return Swal.fire('達上限', '為確保介面體驗，大分類最多只能建立 9 組！', 'warning');
    }
    
    const { value: name } = await Swal.fire({
        title: '新增大分類',
        input: 'text',
        inputPlaceholder: '例如：茶葉、服飾',
        target: document.getElementById('categoryModal'),
        didOpen: () => { setTimeout(() => Swal.getInput().focus(), 100); },
        showCancelButton: true,
        inputValidator: (value) => {
            if (!value) return '請輸入分類名稱！';
            if (value.length > 8) return '名稱過長，建議 8 字以內';
        }
    });

    if (name) await saveCategoryData({ name: name, parent_id: null, level: 1 });
}

// 新增小分類 (限制 9 組 + 焦點修復)
export async function addSubCategory() {
    if (!currentSelectedMainCatId) {
        return Swal.fire('提示', '請先在左側選擇一個大分類！', 'info');
    }
    
    const subCats = window.catDataCache.sub[currentSelectedMainCatId] || [];
    if (subCats.length >= 9) {
        return Swal.fire('達上限', '該分類下的小分類已達 9 組上限！', 'warning');
    }

    const { value: name } = await Swal.fire({
        title: '新增小分類',
        input: 'text',
        inputPlaceholder: '例如：大禹嶺、上衣',
        target: document.getElementById('categoryModal'),
        didOpen: () => { setTimeout(() => Swal.getInput().focus(), 100); },
        showCancelButton: true,
        inputValidator: (value) => {
            if (!value) return '請輸入分類名稱！';
            if (value.length > 8) return '名稱過長，建議 8 字以內';
        }
    });

    if (name) await saveCategoryData({ name: name, parent_id: currentSelectedMainCatId, level: 2 });
}

// 寫入資料庫
async function saveCategoryData(data, categoryId = null) {
    toggleLoader('loader-products', true);
    try {
        await API.saveCategory(window.currentDbId, categoryId, data);
        await loadCategories(true); // 強制重抓
        if (!categoryId && data.level === 1) currentSelectedMainCatId = null;
        renderMainCategories();
        renderSubCategories();
        updateProductFilterDropdown();
    } catch (e) {
        Swal.fire('錯誤', e.message, 'error');
    }
    toggleLoader('loader-products', false);
}

// 🌟 更新商品列表上的「篩選下拉選單」(加入下架標示)
function updateProductFilterDropdown() {
    const filterSelect = document.getElementById('prod-filter-main-cat');
    if (!filterSelect) return;
    
    let html = '<option value="all">所有分類</option>';
    window.catDataCache.main.forEach(cat => {
        const isActive = cat.is_active !== false && cat.listing !== false;
        const statusText = isActive ? '' : ' (已下架)';
        html += `<option value="${cat.id}">${cat.name}${statusText}</option>`;
    });
    filterSelect.innerHTML = html;
}

// 🌟 SaaS 分類狀態切換器 (寫入資料庫)
export async function toggleCategoryStatus(id, currentStatus) {
    const newStatus = !currentStatus;
    const actionText = newStatus ? '上架' : '下架';
    
    // 加入二次確認，防止店長手滑誤觸
    const confirm = await Swal.fire({
        title: `確定要${actionText}此分類嗎？`,
        text: newStatus 
            ? "上架後，AI 將恢復推薦此分類與其底下的商品。" 
            : "下架後，該分類與其底下所有關聯商品將「瞬間消失」在 AI 導購選單中！",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: `確定${actionText}`,
        cancelButtonText: '取消',
        target: document.getElementById('categoryModal') // 確保 Swal 顯示在最上層
    });

    if (confirm.isConfirmed) {
        // saveCategoryData 會自動處理 loading 動畫並重繪左右兩邊的列表
        await saveCategoryData({ is_active: newStatus }, id);
        
        // 偷偷提示一下成功
        Swal.fire({
            title: `${actionText}成功！`,
            icon: 'success',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            target: document.getElementById('categoryModal')
        });
    }
}

// 彈窗內：連動更新小分類下拉選單
export function onProductMainCatChange() {
    const mainSelect = document.getElementById('prod-main-cat');
    const subSelect = document.getElementById('prod-sub-cat');
    if (!mainSelect || !subSelect) return;

    const mainId = mainSelect.value;
    subSelect.innerHTML = '<option value="">無</option>';
    
    if (mainId && window.catDataCache.sub[mainId]) {
        window.catDataCache.sub[mainId].forEach(sub => {
            // 🌟 總監優化：判斷是否下架，加上文字提示
            const isActive = sub.is_active !== false && sub.listing !== false;
            const statusText = isActive ? '' : ' (已下架)';
            subSelect.innerHTML += `<option value="${sub.id}">${sub.name}${statusText}</option>`;
        });
    }
}


// ==========================================
// 🚀 3. 核心優化：渲染商品列表 (ID 關聯過濾)
// ==========================================
export async function loadProducts() {
    toggleLoader('loader-products', true); 
    await loadCategories(); // 確保分類資料已載入
    const snap = await API.getProducts(window.currentDbId); 
    toggleLoader('loader-products', false);
    
    updateProductFilterDropdown(); // 更新列表下拉選單

    const div = document.getElementById('product-list'); 
    div.innerHTML = '';
    
    // 重置搜尋框與下拉選單狀態
    const searchInput = document.getElementById('prod-search-filter');
    if (searchInput) searchInput.value = '';
    const statusSelect = document.getElementById('prod-status-filter');
    if (statusSelect) statusSelect.value = 'all';
    const catSelect = document.getElementById('prod-filter-main-cat');
    if (catSelect) catSelect.value = 'all';

    if (snap.empty) { 
        div.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="bi bi-box-seam display-3 text-secondary opacity-25"></i>
                <p class="mt-3 fw-bold fs-5">尚未建立任何商品</p>
                <button class="btn btn-primary mt-2" onclick="window.openProductModal()">立即新增第一件商品</button>
            </div>`; 
        return; 
    }
    
    window.prodDataCache = window.prodDataCache || {}; 
    
    snap.forEach(doc => {
        const p = doc.data(); 
        window.prodDataCache[doc.id] = p;
        const hiddenTags = p.desc ? `<span class="d-none">${p.desc}</span>` : '';
        const isListing = p.listing !== false; // 判斷上下架
        
        // 🌟 分類徽章 (使用儲存的名稱)
        let catBadge = '';
        if (p.main_category) {
            catBadge = `<span class="badge bg-primary me-1 mb-1"><i class="bi bi-diagram-3"></i> ${p.main_category}</span>`;
            if (p.sub_category) {
                catBadge += `<span class="badge bg-success me-2 mb-1"><i class="bi bi-arrow-return-right"></i> ${p.sub_category}</span>`;
            }
        } else {
            catBadge = `<span class="badge bg-secondary me-2 mb-1 opacity-50">未分類</span>`;
        }

        // 1. 視覺審核狀態
        let aiAuditBadge = (p.ai_system_audit && p.ai_system_audit.system_route) 
            ? '<span class="badge bg-info text-dark ms-1 mb-1" style="font-size:0.7rem;"><i class="bi bi-eye-fill"></i> 視覺已審核</span>' 
            : '';
            
        // 2. 向量座標狀態
        let embeddingBadge = '';
        const hasData = p.embedding !== undefined && p.embedding !== null;
        const isOldArray = Array.isArray(p.embedding);

        if (hasData && !isOldArray) {
            embeddingBadge = '<span class="badge bg-success ms-1 mb-1" style="font-size:0.7rem;"><i class="bi bi-geo-alt-fill"></i> 數據已檢索</span>';
        } else {
            embeddingBadge = '<span class="badge bg-warning text-dark ms-1 mb-1" style="font-size:0.7rem;"><i class="bi bi-exclamation-triangle-fill"></i> 需重存建座標</span>';
        }

        // 3. 沉浸展示標籤
        let showroomBadge = (p.enable_ai_showroom === true)
            ? '<span class="badge ms-1 mb-1" style="font-size:0.7rem; background-color: #6f42c1; color: white;"><i class="bi bi-stars"></i> 已啟用展示</span>'
            : '';

        // 4. [UI 優化] 提取並渲染 Tags
        let aiTags = [];
        let userTags = [];
        if (p.ai_system_audit) {
            aiTags = p.ai_system_audit.ai_tags || [];
            userTags = p.ai_system_audit.user_tags || [];
        } else {
            const rawDesc = p.desc || '';
            const tagMatch = rawDesc.match(/#[\w\u4e00-\u9fa5]+/g);
            if (tagMatch) userTags = tagMatch.map(t => t.replace('#', ''));
        }

        let tagsHtml = '';
        if (aiTags.length > 0 || userTags.length > 0) {
            tagsHtml = '<div class="mt-2 d-flex flex-wrap gap-1">';
            aiTags.forEach(t => { tagsHtml += `<span class="badge shadow-sm" style="background-color:#fff3cd; color:#856404; border:1px solid #ffeeba; font-weight:500;"><i class="bi bi-robot"></i> #${t}</span>`; });
            userTags.forEach(t => { tagsHtml += `<span class="badge bg-light text-secondary border shadow-sm" style="font-weight:500;"><i class="bi bi-tag"></i> #${t}</span>`; });
            tagsHtml += '</div>';
        }

        // 🌟 將 data-maincatid 寫入 DOM 供 ID 精準過濾
        div.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center prod-item-row p-3" 
                 data-listing="${isListing}" 
                 data-maincatid="${p.main_category_id || ''}">
                <div class="d-flex align-items-start w-100">
                    <img src="${p.image || ''}" 
                         onerror="this.onerror=null; this.src='https://dummyimage.com/40x40/cccccc/ffffff&text=No+Img';" 
                         class="rounded border me-3 shadow-sm mt-1" 
                         style="width: 50px; height: 50px; min-width: 50px; object-fit: cover;">
                    
                    <div class="flex-grow-1">
                        <div class="mb-1">${catBadge}</div>
                        <strong class="text-dark fs-6">${p.name || '未命名商品'}</strong>
                        <small class="text-danger fw-bold ms-2">$${p.price || 0}</small>
                        ${!isListing ? '<span class="badge bg-secondary ms-2 mb-1">下架中</span>' : ''}
                        
                        <div class="mt-1">
                            ${aiAuditBadge}
                            ${embeddingBadge}
                            ${showroomBadge}
                        </div>
                        
                        ${tagsHtml}
                        ${hiddenTags}
                    </div>
                </div>
                <button onclick="window.openProductModal('${doc.id}')" class="btn btn-sm btn-outline-primary shadow-sm px-3 ms-3">Edit</button>
            </div>`;
    });
}

// ==========================================
// 🚀 4. 商品列表三重條件過濾 (改用 ID 判斷)
// ==========================================
export function filterProductsList() {
    const listContainer = document.getElementById('product-list');
    if (!listContainer) return;
    
    const searchInput = document.getElementById('prod-search-filter');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const statusSelect = document.getElementById('prod-status-filter');
    const status = statusSelect ? statusSelect.value : 'all';
    
    const catSelect = document.getElementById('prod-filter-main-cat');
    const catFilterId = catSelect ? catSelect.value : 'all'; // 這裡取到的是 ID

    const items = listContainer.getElementsByClassName('prod-item-row');
    
    Array.from(items).forEach(item => {
        const textContext = item.textContent.toLowerCase();
        const isListing = item.getAttribute('data-listing') === 'true';
        const itemMainCatId = item.getAttribute('data-maincatid');
        
        let matchSearch = textContext.includes(term);
        
        let matchStatus = true;
        if (status === 'active' && !isListing) matchStatus = false;
        if (status === 'inactive' && isListing) matchStatus = false;
        
        // 🌟 精準 ID 比對
        let matchCat = true;
        if (catFilterId !== 'all' && itemMainCatId !== catFilterId) matchCat = false;

        if (matchSearch && matchStatus && matchCat) {
            item.classList.add('d-flex');
            item.classList.remove('d-none'); 
        } else {
            item.classList.remove('d-flex');
            item.classList.add('d-none'); 
        }
    });
}

// 🌟 打開商品編輯彈窗 (修復幽靈殘留 + 純淨 ID 回填 + 下架標示)
export async function openProductModal(id) {
    await loadCategories();

    const mainSelect = document.getElementById('prod-main-cat');
    const subSelect = document.getElementById('prod-sub-cat');
    
    // 💡 1. 核心修復：不管新增還是編輯，一打開彈窗先「強制歸零」
    if (mainSelect) {
        mainSelect.innerHTML = '<option value="" disabled selected>請選擇大分類...</option>';
        window.catDataCache.main.forEach(cat => {
            // 🌟 總監優化：大分類也要判斷是否下架
            const isActive = cat.is_active !== false && cat.listing !== false;
            const statusText = isActive ? '' : ' (已下架)';
            mainSelect.innerHTML += `<option value="${cat.id}">${cat.name}${statusText}</option>`;
        });
        mainSelect.value = ""; // 強制清空選擇
    }
    if (subSelect) {
        subSelect.innerHTML = '<option value="">無</option>'; // 強制清空小分類
    }

    const tagInput = document.getElementById('tag-input');
    if (tagInput && !document.getElementById('tag-helper-text')) {
        const helperText = document.createElement('div'); 
        helperText.id = 'tag-helper-text'; 
        helperText.className = 'mt-2 p-2 bg-light border rounded small text-muted';
        
        helperText.innerHTML = `
            <div class="mb-2 d-flex justify-content-between align-items-center">
                <span><i class="bi bi-info-circle-fill text-primary"></i> <b>標籤防呆設定指南：</b></span>
                <button type="button" id="btn-ai-tags" class="btn btn-sm btn-outline-success fw-bold py-0" onclick="window.fetchAiTags()">
                    <i class="bi bi-stars"></i> 獲取 AI 建議標籤
                </button>
            </div>
            • 輸入後按 <kbd>Enter</kbd> 加入。<br>
            • <code>VIP</code> 設為專屬商品。<br>
            <span class="text-danger fw-bold">• 💡 AI 小撇步：請使用主體清晰的商品圖進行分析。若使用背景雜亂的「情境圖」，AI 可能會抓錯重點喔！</span>
            <div id="ai-tag-suggestions" class="mt-2 p-2 bg-white rounded border" style="display:none;"></div>
        `;
        tagInput.parentNode.insertBefore(helperText, tagInput.nextSibling);
    }
    
    const aiContainer = document.getElementById('ai-tag-suggestions');
    if (aiContainer) aiContainer.style.display = 'none';

    tempSystemRoute = "VTO_PERSON"; 
    lastAuditedImgUrl = ""; 
    hasValidAuditRecord = false; 
    lockedAiTags = [];

    const vtoToggle = document.getElementById('prod-enable-vto'); 

    if(id) { 
        const p = window.prodDataCache[id]; 
        setVal('prod-id', id); 
        setVal('prod-name', p.name); 
        setVal('prod-price', p.price); 
        setVal('prod-listing', p.listing === false ? 'false' : 'true'); 
        setVal('prod-img', p.image || ''); 
        setVal('prod-url', p.url || ''); 
        
        // 💡 2. 純淨的 ID 綁定：有存 ID 才選取，沒有 ID 就不動（維持上面的歸零狀態）
        if (mainSelect && p.main_category_id) {
            mainSelect.value = p.main_category_id;
            onProductMainCatChange(); 
            if (subSelect && p.sub_category_id) {
                subSelect.value = p.sub_category_id;
            }
        }

        const rawDesc = p.desc || ''; 
        const tagMatch = rawDesc.match(/#[\w\u4e00-\u9fa5]+/g); 
        tempTags = tagMatch ? tagMatch.map(t => t.replace('#', '')) : []; 
        setVal('prod-desc', rawDesc.replace(/#[\w\u4e00-\u9fa5]+/g, '').trim());

        if (vtoToggle) vtoToggle.checked = (p.enable_ai_showroom !== false);

        if (p.ai_system_audit && p.ai_system_audit.ai_tags) {
            lockedAiTags = p.ai_system_audit.ai_tags;
        } else {
            lockedAiTags = [];
        }
        
        if (p.ai_system_audit && p.ai_system_audit.system_route) {
            tempSystemRoute = p.ai_system_audit.system_route;
            hasValidAuditRecord = true; 
        }
        
        lastAuditedImgUrl = p.image || ''; 

        renderTagChips(); 
        document.getElementById('btn-prod-del').style.display = 'block'; 
    } else { 
        setVal('prod-id', ""); 
        setVal('prod-name', ""); 
        setVal('prod-price', ""); 
        setVal('prod-listing', "true"); 
        setVal('prod-img', ""); 
        setVal('prod-url', ""); 
        setVal('prod-desc', ""); 
        // 這裡不用再寫清空選單了，因為第一步已經歸零了

        tempTags = []; 
        renderTagChips(); 
        document.getElementById('btn-prod-del').style.display = 'none'; 
        
        if (vtoToggle) vtoToggle.checked = true;
    }

    const btnAi = document.getElementById('btn-ai-tags');
    if (btnAi) {
        if (hasValidAuditRecord) {
            btnAi.innerHTML = '<i class="bi bi-check-circle-fill"></i> 已完成視覺審核';
            btnAi.disabled = true;
            btnAi.classList.remove('btn-outline-success');
            btnAi.classList.add('btn-success');
        } else {
            btnAi.innerHTML = '<i class="bi bi-stars"></i> 獲取 AI 建議標籤';
            btnAi.disabled = false;
            btnAi.classList.remove('btn-success');
            btnAi.classList.add('btn-outline-success');
        }
    }

    if(window.productModal) window.productModal.show();
}

// 🌟 寫入商品 (ID 鋼印實作)
export async function saveProduct() { 
    const currentImgUrl = getVal('prod-img');
    const id = getVal('prod-id'); 
    
    const mainSelect = document.getElementById('prod-main-cat');
    const subSelect = document.getElementById('prod-sub-cat');

    // 取得 ID 與 Name (這段是 ID 鋼印的核心)
    const mainCatId = mainSelect ? mainSelect.value : '';
    const mainCatName = (mainSelect && mainSelect.selectedIndex > 0) ? mainSelect.options[mainSelect.selectedIndex].text : '';

    const subCatId = subSelect ? subSelect.value : '';
    const subCatName = (subSelect && subSelect.value !== "") ? subSelect.options[subSelect.selectedIndex].text : '';

    if (!mainCatId) {
        Swal.fire('驗證失敗', '請務必選擇一個「大分類」！', 'warning');
        return;
    }

    let prodUrl = getVal('prod-url').trim();
    if (!prodUrl) {
        Swal.fire('驗證失敗', '「結帳網址」為必填欄位！這關乎到 AI 逼單的準確度，請輸入商品連結。', 'warning');
        return;
    }
    if (prodUrl === '#' || prodUrl.length < 5) {
        Swal.fire('格式錯誤', '請輸入有效的結帳網址，不可只輸入 # 或無效字元。', 'warning');
        return;
    }
    
    let isValidUrl = false;
    if (!prodUrl.startsWith('http') && prodUrl.includes('.')) { prodUrl = 'https://' + prodUrl; }
    
    try {
        const urlObj = new URL(prodUrl);
        if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
            isValidUrl = true; setVal('prod-url', prodUrl);
        }
    } catch (e) { isValidUrl = false; }

    if (!isValidUrl) {
        Swal.fire('格式錯誤', '請輸入真實的商品網址 (例如: https://your-store.com/item)', 'warning');
        return;
    }

    if (currentImgUrl && currentImgUrl.startsWith('http') && (currentImgUrl !== lastAuditedImgUrl || !hasValidAuditRecord)) {
        Swal.fire({ title: '系統安全審核中', text: '執行 AI 路由分析...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
        try {
            const aiResponse = await API.getAiTagSuggestions(window.currentDbId, currentImgUrl);
            tempSystemRoute = aiResponse.system_route || "VTO_PERSON";
            lockedAiTags = aiResponse.tags || []; 
            tempTags = tempTags.filter(t => !lockedAiTags.includes(t));
            lastAuditedImgUrl = currentImgUrl; 
            hasValidAuditRecord = true; 
        } catch (e) {
            Swal.fire('儲存失敗', '強制圖片審核失敗', 'error'); return; 
        }
    }

    let descContentOnly = getVal('prod-desc').trim();
    let descForDisplay = descContentOnly;
    if (tempTags.length > 0) descForDisplay = `${descContentOnly}\n\n${tempTags.map(t => `#${t}`).join(' ')}`;
    
    const vtoToggle = document.getElementById('prod-enable-vto');
    const isVtoEnabled = vtoToggle ? vtoToggle.checked : true;

    const data = { 
        clientId: window.currentDbId, 
        name: getVal('prod-name'), 
        price: Number(getVal('prod-price')), 
        listing: getVal('prod-listing') === 'true', 
        
        // 🌟 雙重寫入 (ID 關聯防斷線，Name 給 AI 看)
        main_category_id: mainCatId,
        main_category: mainCatName,  
        sub_category_id: subCatId,
        sub_category: subCatName,    
        
        image: currentImgUrl, 
        url: prodUrl, 
        desc: descForDisplay, 
        enable_ai_showroom: isVtoEnabled, 
        ai_system_audit: {
            system_route: tempSystemRoute,
            ai_tags: lockedAiTags, 
            user_tags: tempTags,   
            last_audited_at: new Date().toISOString()
        }
    }; 

    try {
        Swal.fire({ title: 'AI 建立索引中', text: '正在精煉搜尋座標...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
        const officialTags = [...new Set([...lockedAiTags, ...tempTags])];
        const textToEmbed = `[分類]:${data.main_category}>${data.sub_category} [標籤]:${officialTags.join(', ')} [品名]:${data.name} [價格]:NT$${data.price}`.trim();
        console.log("🚀 AI 搜尋 DNA：", textToEmbed);

        const embeddingResult = await API.getProductEmbedding(window.currentDbId, textToEmbed);
        if (embeddingResult && embeddingResult.embedding) {
            data.embedding = embeddingResult.embedding; 
        }
    } catch (e) { console.warn("⚠️ 座標產生失敗:", e); }

    if (Swal.isVisible()) {
        Swal.close();
        await new Promise(resolve => setTimeout(resolve, 300)); 
    }
    
    await API.saveProduct(id, data); 
    if(window.productModal) window.productModal.hide(); 
    loadProducts(); 
}

export async function deleteProduct() { 
    if(confirm("確定刪除？")) { 
        await API.deleteProduct(getVal('prod-id')); 
        if(window.productModal) window.productModal.hide(); 
        loadProducts(); 
    } 
}

export function addTagFromInput(val) { 
    const cleanVal = val.trim().replace(/#/g, '').replace(/,/g, ''); 
    if (cleanVal && !tempTags.includes(cleanVal)) { tempTags.push(cleanVal); renderTagChips(); } 
}

export function renderTagChips() {
    const container = document.getElementById('tag-container'); 
    const input = document.getElementById('tag-input'); 
    if (!container || !input) return; 
    container.querySelectorAll('.tag-chip').forEach(el => el.remove());
    lockedAiTags.forEach((tag) => {
        const chip = document.createElement('div'); chip.className = 'tag-chip'; 
        chip.innerHTML = `<span style="margin-right:5px;"><i class="bi bi-robot"></i> #${tag}</span><i class="bi bi-lock-fill text-secondary"></i>`;
        chip.style.cssText = "background-color:#fff3cd; color:#856404; border:1px solid #ffeeba; border-radius:50px; padding:2px 10px; font-size:0.85rem; display:flex; align-items:center; white-space:nowrap; cursor:not-allowed;"; 
        container.insertBefore(chip, input);
    });
    tempTags.forEach((tag, index) => {
        const chip = document.createElement('div'); chip.className = 'tag-chip'; 
        chip.innerHTML = `<span style="margin-right:5px;">#${tag}</span><i class="bi bi-x-circle-fill text-secondary" style="cursor:pointer;" onclick="window.removeTag(${index})"></i>`;
        chip.style.cssText = "background-color:#e9ecef; border:1px solid #dee2e6; border-radius:50px; padding:2px 10px; font-size:0.85rem; display:flex; align-items:center; white-space:nowrap;"; 
        container.insertBefore(chip, input);
    });
}
export function removeTag(index) { tempTags.splice(index, 1); renderTagChips(); }

export async function fetchAiTags() {
    const imgUrl = getVal('prod-img');
    if (!imgUrl || !imgUrl.startsWith('http')) { return Swal.fire('提示', '請先輸入有效的商品圖片 URL 再進行分析。', 'warning'); }
    
    const confirm = await Swal.fire({
        title: '確認執行 AI 分析？',
        text: '此操作將啟動「🦅 鷹眼視覺分析」模型，系統將依照圖片複雜度與 Token 消耗量進行標準算力扣款（與客人在 LINE 傳圖片的算力成本相同）。',
        icon: 'info', showCancelButton: true, confirmButtonText: '確定分析', cancelButtonText: '取消'
    });
    if (!confirm.isConfirmed) return;

    const btn = document.getElementById('btn-ai-tags');
    const container = document.getElementById('ai-tag-suggestions');
    if (btn) { btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 分析中...'; btn.disabled = true; }
    
    try {
        const aiResponse = await API.getAiTagSuggestions(window.currentDbId, imgUrl);
        lockedAiTags = aiResponse.tags || [];
        tempSystemRoute = aiResponse.system_route || "VTO_PERSON"; 
        lastAuditedImgUrl = imgUrl; 
        hasValidAuditRecord = true; 
        tempTags = tempTags.filter(t => !lockedAiTags.includes(t));
        renderTagChips();

        if (btn) {
            btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> 已完成視覺審核';
            btn.disabled = true;
            btn.classList.remove('btn-outline-success');
            btn.classList.add('btn-success');
        }

        if (lockedAiTags.length > 0) {
            let routeHint = "";
            if(tempSystemRoute === "SCENE_GEN") routeHint = "<span class='text-warning small'>⚠️ 系統判定此為高隱私或情境商品，已鎖定保護模式與特徵標籤。</span>";
            if(tempSystemRoute === "STATIC") routeHint = "<span class='text-secondary small'>📦 系統判定此為標準商品，已鎖定基礎特徵標籤。</span>";
            if(tempSystemRoute === "VTO_PERSON") routeHint = "<span class='text-success small'>✅ 系統判定此為安全服飾，已寫入特徵標籤，可支援真人試穿。</span>";
            
            container.innerHTML = `<div class="text-dark small fw-bold mb-1"><i class="bi bi-shield-lock-fill text-success"></i> AI 視覺海關已完成檢驗並打上特徵鋼印。您可以繼續在下方輸入列補充其他行銷標籤。</div><div class="mt-2">${routeHint}</div>`;
            container.style.display = 'block';
        } else {
            container.innerHTML = `<div class="text-muted small">AI 未找到明顯特徵，請嘗試其他圖片。</div>`;
            container.style.display = 'block';
        }
    } catch (e) {
        Swal.fire('分析失敗', e.message, 'error');
        if (btn) {
            btn.innerHTML = '<i class="bi bi-stars"></i> 獲取 AI 建議標籤';
            btn.disabled = false;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-outline-success');
        }
    }
}

export function initProductsModule() {
    Object.assign(window, { 
        initGoogleMapsAutocomplete, renderStoreList, addStoreItem, removeStoreItem, loadProducts, filterProductsList, openProductModal, saveProduct, deleteProduct, addTagFromInput, renderTagChips, removeTag, fetchAiTags,
        openCategoryModal, selectMainCategory, addMainCategory, addSubCategory, editCategoryName, onProductMainCatChange, toggleCategoryStatus
    }); 
    
    setTimeout(() => {
        const tagInput = document.getElementById('tag-input');
        if (tagInput) {
            const newTagInput = tagInput.cloneNode(true); 
            tagInput.parentNode.replaceChild(newTagInput, tagInput);
            newTagInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); window.addTagFromInput(this.value); this.value = ''; } });
            newTagInput.addEventListener('blur', function() { window.addTagFromInput(this.value); this.value = ''; });
        }
        
        const imgInput = document.getElementById('prod-img');
        if (imgInput) {
            imgInput.addEventListener('input', function() {
                const currentUrl = this.value.trim();
                if (currentUrl !== lastAuditedImgUrl) {
                    hasValidAuditRecord = false; lockedAiTags = []; renderTagChips(); 
                    const btnAi = document.getElementById('btn-ai-tags');
                    if (btnAi) {
                        btnAi.innerHTML = '<i class="bi bi-stars"></i> 重新獲取 AI 標籤';
                        btnAi.disabled = false; btnAi.classList.remove('btn-success'); btnAi.classList.add('btn-outline-success');
                    }
                    const aiContainer = document.getElementById('ai-tag-suggestions');
                    if (aiContainer) aiContainer.style.display = 'none';
                }
            });
        }
    }, 1000);
}
