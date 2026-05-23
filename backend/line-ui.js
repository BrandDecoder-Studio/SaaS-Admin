/**
 * 🎨 Line UI Generator (line-ui.js)
 * Version: v4.2 (Immersive Showroom UI Upgrade + Item-Level Switch) 🚀
 * Description: 
 * 1. [Fix] 移除雙重字串比對，完全信任 index.js (Fuse.js) 傳來的配對結果。
 * 2. 引入「CTA 永動機」：商品卡片底部新增黃金引導按鈕。
 * 3. [Fix] 安全 URL 編碼：保護 Redirect 伺服器不崩潰。
 * 4. [New] 🌟 動態渲染「沉浸展示間」按鈕：支援 Postback 綁定特定 productId 與一次性 Nonce。
 * 5. 🛡️ [New] 支援「單品級別」開關 (enable_ai_showroom !== false)，替店家省算力！
 */

// 🌟 設定你的 Redirect 服務網址
const REDIRECT_BASE_URL = "https://redirect-217800246535.asia-east1.run.app";

/**
 * 🛠️ 輔助函數：建立追蹤轉跳網址 (安全編碼版)
 */
function buildRedirectUrl(originalUrl, type, trackingInfo = {}) {
    if (!originalUrl) return "https://google.com"; // 防錯機制
    
    const { tid = 'unknown', cid = 'unknown', uid = 'unknown', pid = 'unknown' } = trackingInfo;
    
    const safeTid = encodeURIComponent(tid);
    const safeCid = encodeURIComponent(cid);
    const safeUid = encodeURIComponent(uid);
    const safePid = encodeURIComponent(pid);
    const safeType = encodeURIComponent(type);
    const safeUrl = encodeURIComponent(originalUrl);
    
    return `${REDIRECT_BASE_URL}?tid=${safeTid}&cid=${safeCid}&uid=${safeUid}&pid=${safePid}&type=${safeType}&url=${safeUrl}`;
}

// 建立商品卡片 (Flex Message)
// 🌟 [修改] 新增 enableShowroom 參數 (代表店家全域開關，預設為 false 防呆)
async function createProductFlex(productsToRender, productNamesToFind, trackingInfo = {}, enableShowroom = false) {
    if (!productsToRender || productsToRender.length === 0) return null;

    // 製作 Carousel
    const bubbles = productsToRender.map(product => {
        // 🌟 1. 清洗文案：把給 AI 看的 #標籤 偷偷濾掉，只留給客人看純淨文案
        let rawDesc = product.desc || "";
        let cleanDesc = rawDesc.replace(/#[\w\u4e00-\u9fa5]+/g, '').trim();

        // 🌟 2. 設定優雅預設值
        let displayDesc = cleanDesc || "點擊下方按鈕查看詳細商品資訊與規格。";

        // 🌟 3. 放寬 LINE 字數限制 (大約 60 字配 maxLines: 2 最完美)
        if (displayDesc.length > 60) {
            displayDesc = displayDesc.substring(0, 57) + "...";
        }

        // 確保有有效的商品 ID，如果沒有就拿名字頂著用
        const productId = product.id || product.name || "unknown_id"; 
        const redirectUri = buildRedirectUrl(
            product.url || "https://google.com", 
            "product", 
            { ...trackingInfo, pid: productId }
        );

        // ==========================================
        // 🌟 按鈕區塊動態組裝
        // ==========================================
        const actionButtons = [
            // 按鈕 1: 原本的立即購買 (必定顯示)
            {
                type: "button",
                style: "primary",
                height: "sm",
                color: "#28A745",
                action: { type: "uri", label: "👇 直接下訂", uri: redirectUri }
            }
        ];

        // 🌟 核心防禦修正：只有當「店家全域開啟」且「此單一商品未被關閉」時，才顯示按鈕！
        if (enableShowroom && product.enable_ai_showroom !== false) {
            // 🛡️ [絕對防禦] 產生 8 碼隨機字串作為一次性憑證 (Nonce)
            const nonce = Math.random().toString(36).substring(2, 10);

            actionButtons.push({
                type: "button",
                style: "secondary", // 用次要顏色與購買區隔
                height: "sm",
                margin: "sm", // 與上方按鈕保持一點距離
                color: "#d3dde3",
                // 🔒 將 nonce 偷偷塞進 data 裡面傳給後端
                action: { 
                    type: "postback", 
                    label: "🪄 啟動展示間", 
                    data: `action=start_showroom&productId=${productId}&nonce=${nonce}` 
                }
            });
        }

        return {
            type: "bubble",
            hero: { 
                type: "image",
                url: product.image || "https://via.placeholder.com/300?text=No+Image",
                size: "full",
                aspectRatio: "20:13",
                aspectMode: "cover"
            },
            body: { 
                type: "box",
                layout: "vertical",
                contents: [
                    { type: "text", text: product.name, weight: "bold", size: "md", wrap: true },
                    { 
                        type: "text", 
                        text: `$${product.price ? Number(product.price).toLocaleString() : '0'}`, 
                        weight: "bold", size: "xl", color: "#e63946", margin: "md" 
                    },
                    // 🌟 這裡套用清洗過、長度剛好的純淨文案
                    { 
                        type: "text", 
                        text: displayDesc, 
                        size: "xs", color: "#666666", margin: "xs", wrap: true, maxLines: 2 
                    }
                ]
            },
            footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                // 🌟 把剛才動態組裝好的按鈕陣列塞進來
                contents: actionButtons
            }
        };
    });

    return { type: "flex", altText: "為您推薦精選商品", contents: { type: "carousel", contents: bubbles } };
}

// 建立地圖卡片 (Flex Message)
async function createMapFlex(locations, trackingInfo = {}) {
    if (!locations || locations.length === 0) return null;
    
    const DEFAULT_MAP_IMG = "https://images.unsplash.com/photo-1524661135-423995f22d0b?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80";

    const bubbles = locations.map(loc => {
        const displayName = loc.name || "📍 門市導航";
        const displayAddr = loc.addressText || "點擊查看地圖";
        const originalMapUrl = loc.mapUrl || "https://maps.google.com";
        
        const locationId = loc.id || displayName;
        const mapRedirectUri = buildRedirectUrl(
            originalMapUrl, 
            "map", 
            { ...trackingInfo, pid: locationId }
        );

        return {
            type: "bubble",
            size: "mega",
            hero: {
                type: "image",
                url: DEFAULT_MAP_IMG,
                size: "full",
                aspectRatio: "20:13",
                aspectMode: "cover",
                action: { type: "uri", uri: mapRedirectUri } 
            },
            body: { 
                type: "box",
                layout: "vertical",
                contents: [
                    { type: "text", text: "📍 門市導航", weight: "bold", color: "#1DB446", size: "xs" },
                    { type: "text", text: displayName, weight: "bold", size: "lg", margin: "md", wrap: true },
                    { type: "text", text: displayAddr, size: "sm", color: "#666666", margin: "sm", wrap: true }
                ]
            },
            footer: {
                type: "box",
                layout: "horizontal",
                spacing: "sm",
                contents: [
                    {
                        type: "button",
                        style: "primary",
                        color: "#4285F4",
                        action: { type: "uri", label: "開啟 Google Maps", uri: mapRedirectUri } 
                    }
                ]
            }
        };
    }).filter(b => b !== null);

    if (bubbles.length === 0) return null;

    return { type: "flex", altText: "門市地圖資訊", contents: { type: "carousel", contents: bubbles } };
}

module.exports = { createProductFlex, createMapFlex };