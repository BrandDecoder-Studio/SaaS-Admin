/**
 * js/partner-app.js (v3 - 撥點紀錄完整版)
 */
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, googleProvider, db } from "./config.js"; 
import * as API from "./api.js"; // 引入 API

window.currentPartnerData = null;
window.currentPartnerId = null;

const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num);

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active-section'));
    document.getElementById(viewId).classList.add('active-section');
}

window.handlePartnerLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); } catch (error) { Swal.fire('登入失敗', error.message, 'error'); }
};

window.handlePartnerLogout = async () => {
    await signOut(auth);
    window.location.reload();
};

window.copyReferralLink = () => {
    const linkInput = document.getElementById('referral-link');
    linkInput.select();
    navigator.clipboard.writeText(linkInput.value);
    Swal.fire({ title: '已複製！', text: '趕快把連結發給客戶吧', icon: 'success', timer: 1500, showConfirmButton: false });
};

// 🌟 [新增] 核心功能：載入代理商專屬客戶名單
window.loadMyClients = async () => {
    const listContainer = document.getElementById('partner-client-list');
    if(!listContainer) return;
    listContainer.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div> 名單檢索中...</div>';

    try {
        const snap = await API.getPartnerClients(window.currentPartnerId);
        if (snap.empty) {
            listContainer.innerHTML = '<div class="text-center py-5 text-muted">目前尚未有名下客戶，請先使用推廣連結邀請！</div>';
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-hover align-middle mb-0">';
        html += '<thead class="table-light"><tr><th>品牌名稱</th><th>管理員 Email</th><th class="text-end">目前餘額</th><th class="text-end">操作</th></tr></thead><tbody>';
        
        // 🚨 修正：把 ssnap 改回 snap
        snap.forEach(d => {
            const data = d.data();
            html += `
                <tr>
                    <td class="fw-bold text-dark">${data.name}</td>
                    <td class="small text-muted d-none d-md-table-cell">${data.adminEmail}</td>
                    <td class="text-end fw-bold text-primary">${formatNumber(data.balance_points || 0)}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-info fw-bold me-1" onclick="window.viewTransferLogs('${d.id}', '${data.name}')" title="撥點紀錄">
                            <i class="bi bi-clock-history"></i> <span class="d-none d-lg-inline">紀錄</span>
                        </button>
                        <button class="btn btn-sm btn-success fw-bold" onclick="window.initTransfer('${d.id}', '${data.name}')" title="劃撥點數">
                            <i class="bi bi-plus-circle"></i> <span class="d-none d-lg-inline">劃撥</span>
                        </button>
                    </td>
                </tr>`;
        });
        
        html += '</tbody></table></div>';
        listContainer.innerHTML = html;
    } catch (e) {
        listContainer.innerHTML = '<div class="alert alert-danger small">載入失敗: ' + e.message + '</div>';
    }
};

// 🌟 [新增] 載入代理商的分潤報表
window.loadCommissions = async () => {
    const container = document.getElementById('commission-list-container');
    if(!container) return;

    try {
        // 1. 顯示該代理商專屬的分潤比例 (例如 0.2 變成 20%)
        const rate = window.currentPartnerData.commission_rate || 0;
        const rateSpan = document.getElementById('partner-commission-rate');
        if(rateSpan) rateSpan.innerText = (rate * 100).toFixed(0);

        // 2. 撈取資料庫
        const snap = await API.getPartnerCommissions(window.currentPartnerId);
        
        let pendingTotal = 0;
        let paidTotal = 0;
        let logs = [];

        // 3. 計算總額與分類
        snap.forEach(doc => {
            const data = doc.data();
            logs.push(data);
            if (data.status === 'pending') pendingTotal += (data.earned || 0);
            if (data.status === 'paid') paidTotal += (data.earned || 0);
        });

        document.getElementById('pending-commission').innerText = formatNumber(pendingTotal);
        document.getElementById('paid-commission').innerText = formatNumber(paidTotal);

        // 4. 渲染表格
        if (logs.length === 0) {
            container.innerHTML = '<div class="alert alert-light text-center border text-muted mt-3">目前尚未有推廣分潤紀錄，趕快將上面的專屬連結分享給客戶吧！</div>';
            return;
        }

        // 依照時間降冪排序 (最新的在上面)
        logs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        let html = '<div class="table-responsive mt-2"><table class="table table-sm table-hover align-middle">';
        html += '<thead class="table-light"><tr><th class="small text-muted">產生時間</th><th class="small text-muted">客戶名稱</th><th class="small text-end text-muted">客戶消費</th><th class="small text-end text-muted">您的分潤</th><th class="small text-center text-muted">狀態</th></tr></thead><tbody>';
        
        logs.forEach(log => {
            const date = log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleDateString() : '-';
            const statusBadge = log.status === 'paid' 
                ? '<span class="badge bg-success bg-opacity-10 text-success border border-success">已結清</span>' 
                : '<span class="badge bg-warning bg-opacity-10 text-warning border border-warning">未結算</span>';

            html += `<tr>
                <td class="small text-secondary">${date}</td>
                <td class="small fw-bold text-dark">${log.clientName || '未知客戶'}</td>
                <td class="small text-end text-muted">NT$ ${formatNumber(log.amount || 0)}</td>
                <td class="small text-end fw-bold text-success">+NT$ ${formatNumber(log.earned || 0)}</td>
                <td class="small text-center">${statusBadge}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-danger small text-center py-3"><i class="bi bi-exclamation-triangle"></i> 讀取分潤紀錄失敗</div>';
    }
};

// 🌟 [新增] 方案 C 專屬：查看單一客戶的撥點紀錄 (讀取官方 Audit Logs)
window.viewTransferLogs = async (clientId, clientName) => {
    try {
        Swal.fire({ title: '調閱帳冊中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const snap = await API.getClientTransferLogs(clientId);
        
        let logs = [];
        snap.forEach(doc => logs.push(doc.data()));
        
        // 在前端依照時間降冪排序 (最新的在最上面)
        logs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        if (logs.length === 0) {
            Swal.fire('無紀錄', `您尚未對 ${clientName} 進行過劃撥。`, 'info');
            return;
        }

        // 組裝精緻的對帳單表格
        let html = '<div class="table-responsive text-start"><table class="table table-sm table-hover align-middle">';
        html += '<thead class="table-light"><tr><th class="text-muted small">交易時間</th><th class="text-end text-muted small">撥發點數</th></tr></thead><tbody>';
        
        logs.forEach(log => {
            const date = log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : '未知時間';
            // 抓取剛剛交易寫入的點數
            const pts = log.dedicted_points || log.deducted_points || log.amount || 0; 
            
            html += `<tr>
                <td class="small text-secondary">${date}</td>
                <td class="text-end text-success fw-bold">+${formatNumber(pts)}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';

        Swal.fire({
            title: `【${clientName}】<br><span class="fs-6 text-muted">歷史撥點紀錄</span>`,
            html: html,
            width: '500px',
            confirmButtonText: '關閉帳冊',
            confirmButtonColor: '#1a2538'
        });
        
    } catch (e) {
        console.error("讀取紀錄失敗", e);
        Swal.fire('系統錯誤', '無法讀取紀錄，請聯絡總部。', 'error');
    }
};

// 🌟 核心功能：啟動劃撥流程
window.initTransfer = async (clientId, clientName) => {
    const { value: amount } = await Swal.fire({
        title: `劃撥給 ${clientName}`,
        input: 'number',
        inputLabel: '請輸入要撥發的點數數量',
        inputPlaceholder: '例如: 100000',
        showCancelButton: true,
        confirmButtonText: '確認撥發',
        cancelButtonText: '取消',
        confirmButtonColor: '#198754',
        inputAttributes: { min: 1, step: 1000 },
        inputValidator: (value) => {
            const numValue = Number(value);
            if (!value || numValue <= 0) return '請輸入正確的點數數量！';
            // 🚨 新增：嚴格檢查是否為整數
            if (!Number.isInteger(numValue)) return '劃撥點數必須為「整數」，不可包含小數點！';
        }
    });

    if (amount) {
        try {
            Swal.fire({ title: '點數劃撥中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            // 執行資料庫交易
            await API.transferPoints(window.currentPartnerId, clientId, amount);
            
            // 成功後，同步刷新畫面上的餘額
            const updatedDoc = await getDoc(doc(db, "distributors", window.currentPartnerId));
            document.getElementById('partner-balance').innerText = formatNumber(updatedDoc.data().balance_points);
            
            await Swal.fire('成功！', `已成功將 ${formatNumber(amount)} 點撥給 ${clientName}。`, 'success');
            window.loadMyClients(); // 刷新名單餘額
        } catch (e) {
            Swal.fire('交易失敗', e.message || e, 'error');
        }
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById('user-display').innerText = user.email;
        document.getElementById('btn-logout').style.display = 'inline-block';
        try {
            const q = query(collection(db, "distributors"), where("login_email", "==", user.email));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const partnerDoc = querySnapshot.docs[0];
                window.currentPartnerId = partnerDoc.id;
                window.currentPartnerData = partnerDoc.data();
                document.getElementById('partner-name').innerText = window.currentPartnerData.name;
                document.getElementById('partner-balance').innerText = formatNumber(window.currentPartnerData.balance_points || 0);
                const referralUrl = `https://branddecoderai.com/SaaS-Admin/apply.html?agent=${window.currentPartnerId}`;
                document.getElementById('referral-link').value = referralUrl;
                switchView('dashboard-view');
                // 🚀 進入 Dashboard 後自動載入名單
                window.loadMyClients();
                window.loadCommissions(); // 👈 補上這一行！
            } else {
                Swal.fire({ title: '權限不足', text: '此信箱未綁定經銷商。', icon: 'error' }).then(() => window.handlePartnerLogout());
            }
        } catch (error) { Swal.fire('系統錯誤', error.message, 'error'); }
    } else {
        document.getElementById('user-display').innerText = '';
        document.getElementById('btn-logout').style.display = 'none';
        switchView('login-view');
    }
});
