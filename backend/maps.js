/**
 * 🗺️ Maps Module (maps.js) - v2.2 (Added Store Lookup)
 * ------------------------------------------------
 * 目的：處理門市搜尋、距離計算與單一門市查找。
 * [Fix] v2.1: 強制將經緯度轉為數字 (parseFloat)，防止資料庫格式問題導致計算崩潰。
 * [New] v2.2: 新增 getStoreByName，支援 AI [MAP] Token 的精準查找。
 */

// 模糊搜尋 (用於列表過濾)
function findStores(userQuery, allStores) {
    if (!allStores || allStores.length === 0) return [];
    return allStores.filter(s => 
        (s.name && s.name.includes(userQuery)) || 
        (s.displayAddr && s.displayAddr.includes(userQuery)) || // 🌟 總監建議：補上 displayAddr 支援
        (s.address && s.address.includes(userQuery))
    );
}

// 尋找最近門市 (用於 Location Event)
function findNearestStore(lat, lon, allStores) {
    if (!allStores || allStores.length === 0) return null;

    let nearest = null;
    let minDistance = Infinity;
    const R = 6371; // 地球半徑 (km)
    
    // 確保用戶經緯度是數字
    const uLat = parseFloat(lat);
    const uLon = parseFloat(lon);

    allStores.forEach(store => {
        // 🟢 [Fix] 強制轉型，防止資料庫存成字串導致 NaN 錯誤
        const sLat = parseFloat(store.lat);
        const sLng = parseFloat(store.lng);

        if (!isNaN(sLat) && !isNaN(sLng)) {
            const dLat = (sLat - uLat) * Math.PI / 180;
            const dLon = (sLng - uLon) * Math.PI / 180;
            const a = 
                Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(uLat * Math.PI / 180) * Math.cos(sLat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const d = R * c; 

            if (d < minDistance) {
                minDistance = d;
                nearest = { ...store, distance: d.toFixed(1) };
            }
        }
    });

    return nearest;
}

// 🟢 [New] v2.2 新增：依店名查找詳細資料 (含 lat/lng)
function getStoreByName(storeName, allStores) {
    if (!allStores || allStores.length === 0 || !storeName) return null;
    
    const target = storeName.trim();
    
    // 優先嘗試：完全匹配 (Exact Match)
    let found = allStores.find(s => s.name === target);
    
    // 次要嘗試：模糊匹配 (Fuzzy Match)
    if (!found) {
        found = allStores.find(s => s.name && s.name.includes(target));
    }
    
    return found;
}

// 產生給 AI 的 System Prompt (支援 displayAddr)
function generateSystemPrompt(matchedStores) {
    if (!matchedStores || matchedStores.length === 0) return "";
    return `[SYSTEM: Found ${matchedStores.length} stores] ` + matchedStores.map(s => `${s.name} (地址: ${s.displayAddr || s.address})`).join(", ");
}

module.exports = { findStores, findNearestStore, getStoreByName, generateSystemPrompt };