/**
 * js/modules/war-room.js
 * ------------------------------------------------
 * 🌟 [CTO 互斥鎖最終版] 徹底解決 SPA 切換卡死與非同步競速問題
 */
import * as API from '../api.js';
import { formatNumber, setText } from '../utils.js?v=bypass';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let trafficChartInstance = null;
let intentChartInstance = null;
let heatmapChartInstance = null;

let globalRecommendLogs = null;
let globalLogsFetchTime = 0;
let globalCachedDocId = null; 

// 🔥 新增：互斥鎖與任務追蹤器
let currentRenderTask = 0; 
let lastRenderedDocId = null;

function getSafeDateString(date) {
    const d = new Date(date); 
    let month = '' + (d.getMonth() + 1); 
    let day = '' + d.getDate();
    if (month.length < 2) month = '0' + month; 
    if (day.length < 2) day = '0' + day; 
    return [d.getFullYear(), month, day].join('-');
}

export async function loadBillingStats() {
    const targetDocId = window.currentDocId;
    if (!targetDocId) return;

    // 🔥 發配號碼牌：確保只有最新的一次點擊會被執行
    const myTask = ++currentRenderTask; 
    console.log(`🚀 [戰情室] 任務 #${myTask} 啟動 (目標客戶: ${targetDocId})`);

    // 清空 UI，顯示載入中
    setText('billing-usage-points', '讀取中...');
    setText('billing-usage-count', '--');
    setText('billing-balance', '讀取中...');
    setText('kpi-ai-chats', '--');
    setText('kpi-ai-recommends', '--');
    
    const now = new Date(); 
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; 
    setText('billing-month-title', `${yearMonth} 統計`);
    
    const isTestMode = false; 
    const periodDays = isTestMode ? 1 : 30; 
    const periodMs = periodDays * 24 * 60 * 60 * 1000; 
    const currentPeriodStart = Date.now() - periodMs; 
    const previousPeriodStart = currentPeriodStart - periodMs;

    document.querySelectorAll('.dynamic-period').forEach(el => {
        el.innerText = periodDays === 1 ? '(近 24 小時)' : `(近 ${periodDays} 日)`;
    });

    try {
        // 1. 獲取 Client 資料，校正 DbId
        const clientSnap = await API.getClientById(targetDocId); 
        if (myTask !== currentRenderTask) return; // 🛑 互斥鎖：若有新任務進來，立刻終止舊任務！

        if (!clientSnap || !clientSnap.exists()) {
            setText('billing-balance', '0');
            return;
        }

        const clientData = clientSnap.data();
        setText('billing-balance', formatNumber(clientData.balance_points || 0));

        // 抽出最正確的 DB_ID
        const realDbId = clientData.db_id || clientData.company_id || targetDocId;
        window.currentDbId = realDbId; 

        // 2. 抓取各項數據 (加入中斷檢查)
        const statsSnap = await API.getMonthlyStats(`${realDbId}_${yearMonth.replace('-','_')}`);
        if (myTask !== currentRenderTask) return; // 🛑 互斥鎖檢查

        if(statsSnap.exists()) { 
            const d = statsSnap.data(); 
            setText('billing-usage-points', formatNumber(d.total_points)); 
            setText('billing-usage-count', formatNumber(d.usage_count)); 
        } else {
            setText('billing-usage-points', '0'); 
            setText('billing-usage-count', '0'); 
        }
        
        const logsSnap = await API.getStatsLogs(realDbId);
        if (myTask !== currentRenderTask) return; // 🛑 互斥鎖檢查
        
        let cur = { totalAI: 0, recommends: 0, clicks: 0, leads: 0 }; 
        let prev = { totalAI: 0, recommends: 0, clicks: 0, leads: 0 }; 
        const processedLogs = []; 
        
        logsSnap.forEach(doc => {
            const l = doc.data(); 
            if (!l.timestamp) return; 
            const logTime = l.timestamp.seconds * 1000;
            if (logTime < previousPeriodStart) return; 
            
            const isCurrent = logTime >= currentPeriodStart; 
            const target = isCurrent ? cur : prev; 
            let pDet = {}; try { pDet = JSON.parse(l.details || '{}'); } catch(e){}
            
            if (l.service_type === "SYSTEM_AI" || (pDet.user && pDet.user.includes("AI"))) target.totalAI++;
            if (l.action === "AI_FULL_SEARCH" || l.action === "AI_PRODUCT_FILTERED" || l.action === "AI_MAP_SEARCH") target.recommends++;
            if (l.clicked === true) target.clicks++;
            if (l.action === 'AI_LEAD_CAPTURE') target.leads++;
            
            if (isCurrent) processedLogs.push({ ...l, pDet, id: doc.id });
        });

        let productClicks = 0; let mapClicks = 0;
        try { 
            if (typeof API.getClickLogs === "function") { 
                const clickSnap = await API.getClickLogs(realDbId); 
                clickSnap.forEach(doc => { 
                    const cData = doc.data(); 
                    if (cData.clickedAt && (cData.clickedAt.seconds * 1000) >= currentPeriodStart) { 
                        if (cData.clickType === 'map') mapClicks++; else productClicks++; 
                    } 
                }); 
            } 
        } catch(e) { console.warn("取得 click_logs 失敗", e); }

        if (myTask !== currentRenderTask) return; // 🛑 渲染前最後防護

        // --- 計算與渲染區段 ---
        const calcRate = (n, d) => d > 0 ? ((n / d) * 100).toFixed(1) : 0;
        cur.ctr = calcRate(cur.clicks, cur.recommends); 
        prev.ctr = calcRate(prev.clicks, prev.recommends); 
        cur.leadRate = calcRate(cur.leads, cur.totalAI); 
        prev.leadRate = calcRate(prev.leads, prev.totalAI);
        
        const curSavedCost = Math.round(((cur.totalAI * 3) / 60) * 183); 
        const prevSavedCost = Math.round(((prev.totalAI * 3) / 60) * 183);

        const vsText = `vs 前 ${periodDays} 日`; 
        const getMoMHtml = (currVal, prevVal) => {
            if (prevVal == 0 && currVal > 0) return `<span class="text-success fw-bold"><i class="bi bi-arrow-up-right"></i> +100%</span> <span class="text-muted opacity-75">${vsText}</span>`;
            if (prevVal == 0 && currVal == 0) return `<span class="text-muted opacity-50">- 尚無歷史數據</span>`;
            const diff = currVal - prevVal; 
            const percent = ((Math.abs(diff) / prevVal) * 100).toFixed(1);
            if (diff > 0) return `<span class="text-success fw-bold"><i class="bi bi-arrow-up-right"></i> +${percent}%</span> <span class="text-muted opacity-75">${vsText}</span>`;
            if (diff < 0) return `<span class="text-danger fw-bold"><i class="bi bi-arrow-down-right"></i> -${percent}%</span> <span class="text-muted opacity-75">${vsText}</span>`;
            return `<span class="text-secondary fw-bold"><i class="bi bi-dash"></i> 持平</span> <span class="text-muted opacity-75">${vsText}</span>`;
        };
        const getMoMRateHtml = (currRate, prevRate) => {
            if (prevRate == 0 && currRate > 0) return `<span class="text-success fw-bold"><i class="bi bi-arrow-up-right"></i> +${currRate}%</span> <span class="text-muted opacity-75 d-none d-xl-inline">${vsText}</span>`;
            if (prevRate == 0 && currRate == 0) return `<span class="text-muted opacity-50">- 尚無歷史數據</span>`;
            const diff = (currRate - prevRate).toFixed(1);
            if (diff > 0) return `<span class="text-success fw-bold"><i class="bi bi-arrow-up-right"></i> +${diff}%</span> <span class="text-muted opacity-75 d-none d-xl-inline">${vsText}</span>`;
            if (diff < 0) return `<span class="text-danger fw-bold"><i class="bi bi-arrow-down-right"></i> ${diff}%</span> <span class="text-muted opacity-75 d-none d-xl-inline">${vsText}</span>`;
            return `<span class="text-secondary fw-bold"><i class="bi bi-dash"></i> 持平</span> <span class="text-muted opacity-75 d-none d-xl-inline">${vsText}</span>`;
        };

        setText('kpi-ai-chats', formatNumber(cur.totalAI)); 
        const elChats = document.getElementById('mom-ai-chats'); if(elChats) elChats.innerHTML = getMoMHtml(cur.totalAI, prev.totalAI);
        setText('kpi-ai-recommends', formatNumber(cur.recommends)); 
        const elRecs = document.getElementById('mom-recommends'); if(elRecs) elRecs.innerHTML = getMoMHtml(cur.recommends, prev.recommends);
        setText('kpi-ctr-rate', cur.ctr); 
        const elCtr = document.getElementById('mom-ctr'); if(elCtr) elCtr.innerHTML = getMoMRateHtml(cur.ctr, prev.ctr);
        setText('kpi-saved-hours', ((cur.totalAI * 3) / 60).toFixed(1)); 
        setText('kpi-saved-cost', `$${formatNumber(curSavedCost)}`); 
        const elCost = document.getElementById('mom-saved-cost'); if(elCost) elCost.innerHTML = getMoMHtml(curSavedCost, prevSavedCost);
        setText('kpi-lead-count', formatNumber(cur.leads)); 
        setText('kpi-lead-rate', cur.leadRate); 
        const elLeadRate = document.getElementById('mom-lead-rate'); if(elLeadRate) elLeadRate.innerHTML = getMoMRateHtml(cur.leadRate, prev.leadRate);

        setText('funnel-chats', formatNumber(cur.totalAI)); 
        setText('funnel-recommends', formatNumber(cur.recommends));
        const displayTotalClicks = Math.max(cur.clicks, productClicks + mapClicks);
        setText('funnel-clicks', formatNumber(displayTotalClicks)); 
        setText('funnel-clicks-prod', formatNumber(productClicks)); 
        setText('funnel-clicks-map', formatNumber(mapClicks)); 
        setText('funnel-leads', formatNumber(cur.leads));
        setText('funnel-rate-1', `${calcRate(cur.recommends, cur.totalAI)}%`); 
        setText('funnel-rate-2', `${calcRate(displayTotalClicks, cur.recommends)}%`); 
        setText('funnel-rate-3', `${calcRate(cur.leads, displayTotalClicks)}%`);

        renderTrafficCharts(processedLogs);
        
        // 🌟 [修改] 移除 await，讓 Top 5 排行榜以「異步 (Asynchronous) 背景任務」執行，不再阻塞主畫面的載入
        loadTopProducts(3, myTask).catch(err => console.warn("背景載入爆款排行失敗:", err));
        
        console.log(`✅ [戰情室] 任務 #${myTask} 主畫面渲染結束！(排行背景計算中...)`);

    } catch(e) { 
        console.error(`❌ [戰情室] 任務 #${myTask} 發生嚴重錯誤:`, e); 
        setText('billing-usage-points', '讀取失敗');
    }
}

export async function loadTopProducts(days = 3, parentTask = currentRenderTask) {
    const listContainer = document.getElementById('top-products-list');
    if (!listContainer || !window.currentDocId) return;

    // 換成綠色的轉圈圈，象徵光速模式啟動
    listContainer.innerHTML = '<div class="text-center text-muted py-4 small"><div class="spinner-border spinner-border-sm text-success mb-2" role="status"></div><br>光速讀取聚合報表...</div>';

    try {
        const now = Date.now();
        // 往前推算 N 天的毫秒數
        const cutoffTime = now - (parseInt(days) * 24 * 60 * 60 * 1000);
        const cutoffDate = new Date(cutoffTime);
        
        const clientSnap = await API.getClientById(window.currentDocId);
        if (parentTask !== currentRenderTask) return; // 🛑 互斥鎖檢查

        if (!clientSnap || !clientSnap.exists()) {
            listContainer.innerHTML = '<div class="text-center text-muted py-3 small">找不到專案資料</div>';
            return;
        }

        const dbInstance = clientSnap.ref.firestore; 

        // 🌟【光速讀取 1】直接去抓取已經算好的「每日聚合報表 (daily_product_stats)」
        const statsRef = collection(dbInstance, 'clients', window.currentDocId, 'daily_product_stats');
        const recentStatsQuery = query(statsRef, where("timestamp", ">=", cutoffDate));
        const statsSnap = await getDocs(recentStatsQuery);
        if (parentTask !== currentRenderTask) return; 
        
        const productCounts = {};
        let validCount = 0;

        // 🌟【光速讀取 2】把這 N 天的報表數字直接相加 (迴圈次數極少，絕對不卡頓)
        statsSnap.forEach(doc => {
            const data = doc.data();
            if (data.products) {
                for (const [prodId, count] of Object.entries(data.products)) {
                    productCounts[prodId] = (productCounts[prodId] || 0) + count;
                    validCount += count;
                }
            }
        });

        if (validCount === 0) {
            listContainer.innerHTML = `<div class="text-center text-muted py-4 small bg-light rounded">近 ${days} 天尚無拋單紀錄，等待第一筆開市！</div>`;
            return;
        }

        // 🌟【光速讀取 3】將算好的 ID 排出 Top 5
        let rankedIds = Object.keys(productCounts).map(id => ({ id, count: productCounts[id] }));
        rankedIds.sort((a, b) => b.count - a.count);
        const top5Ids = rankedIds.slice(0, 5);

        // 🌟【光速讀取 4】反查商品真實名稱：去 products 集合把 ID 換成 Name
        const productsRef = collection(dbInstance, 'clients', window.currentDocId, 'products');
        const productsSnap = await getDocs(productsRef);
        const productMap = {};
        productsSnap.forEach(doc => {
            productMap[doc.id] = doc.data().name || '未知商品';
        });

        // 組合最終名單 (防呆：如果商品被刪除了，顯示已下架)
        const top5 = top5Ids.map(item => ({
            name: productMap[item.id] || `已刪除商品 (ID:${item.id})`,
            count: item.count
        }));

        const maxCount = top5[0].count; 

        // 渲染畫面
        let html = '';
        top5.forEach((p, index) => {
            const percentage = Math.round((p.count / maxCount) * 100);
            let rankIcon = `<span class="badge bg-secondary rounded-pill me-2">${index + 1}</span>`;
            if(index === 0) rankIcon = `<span class="badge bg-warning text-dark rounded-pill me-2">🥇 1</span>`;
            if(index === 1) rankIcon = `<span class="badge bg-secondary rounded-pill me-2" style="background-color: #c0c0c0 !important;">🥈 2</span>`;
            if(index === 2) rankIcon = `<span class="badge bg-secondary rounded-pill me-2" style="background-color: #cd7f32 !important;">🥉 3</span>`;

            html += `
                <div class="mb-3">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="small fw-bold text-truncate" style="max-width: 70%;">${rankIcon} ${p.name}</span>
                        <span class="badge bg-success bg-opacity-10 text-success border border-success-subtle rounded-pill px-2" style="font-size:0.7rem;">
                            ${p.count} 次拋單
                        </span>
                    </div>
                    <div class="progress" style="height: 6px;">
                        <div class="progress-bar bg-success progress-bar-striped progress-bar-animated" role="progressbar" style="width: ${percentage}%"></div>
                    </div>
                </div>`;
        });

        listContainer.innerHTML = html;

    } catch (error) {
        console.error("❌ [排行榜] 發生嚴重錯誤:", error);
        listContainer.innerHTML = `<div class="text-center text-danger py-3 small">系統同步中，請稍後重整</div>`;
    }
}

function renderTrafficCharts(logs) {
    const trendCanvas = document.getElementById('trafficTrendChart'); 
    if (trendCanvas) {
        const last7Days = [...Array(7)].map((_, i) => { 
            const d = new Date(); d.setDate(d.getDate() - i); 
            return getSafeDateString(d); 
        }).reverse();
        
        const chatData = last7Days.map(date => logs.filter(l => getSafeDateString(new Date(l.timestamp.seconds * 1000)) === date && l.service_type === "SYSTEM_AI").length);
        const clickData = last7Days.map(date => logs.filter(l => getSafeDateString(new Date(l.timestamp.seconds * 1000)) === date && l.clicked === true).length);
        
        if (trafficChartInstance) trafficChartInstance.destroy();
        
        trafficChartInstance = new Chart(trendCanvas.getContext('2d'), { 
            type: 'line', 
            data: { 
                labels: last7Days.map(d => d.split('-')[2] + '日'), 
                datasets: [ 
                    { label: '🤖 AI 對話量', data: chatData, borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.1)', fill: true, tension: 0.4 }, 
                    { label: '👆 導購點擊', data: clickData, borderColor: '#ffc107', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.4 } 
                ] 
            }, 
            options: { responsive: true, maintainAspectRatio: false } 
        });
    }

    const intentCanvas = document.getElementById('intentChart');
    if (intentCanvas) {
        const iC = { sales:0, qa:0, location:0, chat:0, lead:0 };
        logs.forEach(l => { 
            if(l.action === 'AI_PRODUCT_FILTERED' || l.action === 'AI_FULL_SEARCH') iC.sales++; 
            else if(l.action === 'AI_QA_ANSWER') iC.qa++; 
            else if(l.action === 'AI_MAP_SEARCH' || l.action === 'AI_MAP_NOT_FOUND') iC.location++; 
            else if(l.action === 'AI_LEAD_GUIDANCE' || l.action === 'AI_LEAD_CAPTURE') iC.lead++; 
            else if(l.action === 'AI_CHAT_ONLY') iC.chat++; 
        });
        
        if (intentChartInstance) intentChartInstance.destroy();
        
        intentChartInstance = new Chart(intentCanvas.getContext('2d'), { 
            type: 'doughnut', 
            data: { 
                labels: ['商品導購', '商機引導', '客服 QA', '門市查詢', '一般閒聊'], 
                datasets: [{ data: [iC.sales, iC.lead, iC.qa, iC.location, iC.chat], backgroundColor: ['#198754', '#fd7e14', '#0dcaf0', '#dc3545', '#adb5bd'] }] 
            }, 
            options: { responsive: true, maintainAspectRatio: false, cutout: '65%' } 
        });
    }

    const heatmapCanvas = document.getElementById('heatmapChart');
    if (heatmapCanvas) {
        const hourCounts = new Array(24).fill(0);
        logs.forEach(l => {
            if (l.timestamp) {
                const hour = new Date(l.timestamp.seconds * 1000).getHours();
                hourCounts[hour]++;
            }
        });

        if (heatmapChartInstance) heatmapChartInstance.destroy();
        
        heatmapChartInstance = new Chart(heatmapCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'],
                datasets: [{ label: '互動次數', data: hourCounts, backgroundColor: 'rgba(111, 66, 193, 0.6)', borderRadius: 4, hoverBackgroundColor: 'rgba(111, 66, 193, 1)' }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

export function initWarRoomModule() {
    Object.assign(window, {
        loadBillingStats,
        loadTopProducts
    });

    // 🔥 終極雷達 (Watcher)：專治主程式切換不通知的問題
    setInterval(() => {
        // 確認戰情室頁面是否開啟中 (透過尋找圖表元素)
        const isWarRoomActive = document.getElementById('trafficTrendChart') !== null;
        const activeDocId = window.currentDocId;

        // 如果在戰情室內，且「當前選中的客戶」與「畫面上渲染的客戶」不同
        if (isWarRoomActive && activeDocId && activeDocId !== lastRenderedDocId) {
            console.log(`👀 [雷達] 偵測到側邊欄切換 (${lastRenderedDocId} -> ${activeDocId})，強制觸發重繪！`);
            lastRenderedDocId = activeDocId; // 標記已處理
            loadBillingStats(); 
        }

        // 如果離開戰情室 (切換到 AI大腦 等其他分頁)，重置狀態
        if (!isWarRoomActive && lastRenderedDocId !== null) {
            lastRenderedDocId = null; 
        }
    }, 300); // 每 0.3 秒掃描一次
}
