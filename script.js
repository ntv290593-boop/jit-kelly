// --- DATA STORE ---
let watchlist = JSON.parse(localStorage.getItem('jitWatchlist')) || [];
let portfolio = JSON.parse(localStorage.getItem('jitPortfolio')) || [];
let history = JSON.parse(localStorage.getItem('jitHistory')) || [];

// QUẢN LÝ VỐN
let cashBalance = parseFloat(localStorage.getItem('jitCash')) || 1000000000;
let marginDebt = parseFloat(localStorage.getItem('jitDebt')) || 0;

let mockMarketData = {}; 
let currentTx = null;
let currentNAV = 0; 

// --- INIT APP ---
// Khởi tạo TradingView Widget
new TradingView.widget({
    "autosize": true, "symbol": "HOSE:HPG", "interval": "D", "timezone": "Asia/Ho_Chi_Minh",
    "theme": "dark", "style": "1", "locale": "vi_VN", "enable_publishing": false,
    "allow_symbol_change": true, "container_id": "tradingview_widget"
});

simulatePrices(); 
updateDashboard(); 

// --- UTILS ---
function formatNumber(num) { 
    if (num === undefined || num === null || isNaN(num)) return '0';
    return num.toLocaleString('en-US', {maximumFractionDigits: 0}); 
}
function parseNumber(str) { return parseFloat(String(str).replace(/,/g, '')) || 0; }
function formatCurrencyInput(input) {
    let val = input.value.replace(/\D/g, "");
    input.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if(document.getElementById('txModal').style.display === 'flex') updateTxCalc();
}

// --- CORE LOGIC: DASHBOARD ---
function updateDashboard() {
    let totalStockVal = 0;
    portfolio.forEach(i => {
        const price = mockMarketData[i.sym]?.price || i.buyPrice;
        totalStockVal += price * i.vol * 1000;
    });

    currentNAV = (totalStockVal + cashBalance) - marginDebt;

    const totalAssets = currentNAV + marginDebt;
    let marginRatio = 100;
    if(totalAssets > 0) marginRatio = (currentNAV / totalAssets) * 100;

    document.getElementById('net-worth-display').innerText = formatNumber(currentNAV) + " VND";
    document.getElementById('total-stock-val').innerText = formatNumber(totalStockVal);
    document.getElementById('cash-display').innerText = formatNumber(cashBalance);
    
    const rttEl = document.getElementById('margin-ratio');
    rttEl.innerText = marginRatio.toFixed(2) + "%";
    rttEl.className = "text-sm font-bold " + (marginRatio >= 50 ? "safe-zone" : marginRatio >= 35 ? "warning-zone" : "danger-zone");
}

// --- CORE LOGIC: JIT CALCULATOR ---
function calculateJIT(item) {
    const nav = currentNAV > 0 ? currentNAV : 0; 
    const reward = item.tg - item.ent;
    const risk = item.ent - item.sl;
    const lossPerShare = risk * 1000;
    
    // Quy tắc 1% NAV
    const riskAmt = nav * 0.01; 
    let qRisk = 0;
    if(lossPerShare > 0) qRisk = Math.floor((riskAmt / lossPerShare) / 100) * 100;
    
    // Sức mua theo NAV
    const qNAV = Math.floor((nav / (item.ent * 1000)) / 100) * 100;
    const qSafe = Math.min(qRisk, qNAV);
    
    return { qSafe, totalValue: qSafe * item.ent * 1000 };
}

function saveState() {
    localStorage.setItem('jitCash', cashBalance);
    localStorage.setItem('jitDebt', marginDebt);
    localStorage.setItem('jitWatchlist', JSON.stringify(watchlist));
    localStorage.setItem('jitPortfolio', JSON.stringify(portfolio));
    localStorage.setItem('jitHistory', JSON.stringify(history));
    updateDashboard();
    renderWatchlist();
    renderPortfolio();
    renderHistory();
}

// --- ACCOUNT HANDLERS ---
function openSetupModal() {
    document.getElementById('setupCash').value = formatNumber(cashBalance);
    document.getElementById('setupDebt').value = formatNumber(marginDebt);
    document.getElementById('setupModal').classList.add('open');
}
function saveSetup() {
    cashBalance = parseNumber(document.getElementById('setupCash').value);
    marginDebt = parseNumber(document.getElementById('setupDebt').value);
    saveState();
    closeModal('setupModal');
}

function openImportModal() { document.getElementById('importModal').classList.add('open'); }
// --- CẬP NHẬT HÀM NÀY ĐỂ FIX LỖI TRÙNG MÃ ---
function executeImport() {
    const sym = document.getElementById('impSym').value.toUpperCase();
    const price = parseFloat(document.getElementById('impPrice').value);
    const vol = parseNumber(document.getElementById('impVol').value);
    
    if(!sym || !price || !vol) return alert("Nhập thiếu thông tin!");
    
    // 1. Kiểm tra xem mã này đã có trong Portfolio chưa
    const existingIdx = portfolio.findIndex(p => p.sym === sym);
    
    if(existingIdx !== -1) {
        // CASE A: Đã có -> Gộp vào (Trung bình giá)
        const oldItem = portfolio[existingIdx];
        const newVol = oldItem.vol + vol;
        // Công thức giá vốn TB: (Giá cũ * KL cũ + Giá mới * KL mới) / Tổng KL
        const newAvgPrice = ((oldItem.buyPrice * oldItem.vol) + (price * vol)) / newVol;
        
        portfolio[existingIdx].vol = newVol;
        portfolio[existingIdx].buyPrice = parseFloat(newAvgPrice.toFixed(2));
        
        // Cập nhật các chỉ số JIT (Entry, Target, Stoploss) theo giá mới nếu cần
        // Ở đây ta giữ nguyên setup cũ hoặc reset theo ý ông. 
        // Tạm thời giữ nguyên setup cũ cho an toàn.
        
        alert(`Đã gộp thêm ${formatNumber(vol)} ${sym} vào danh mục!\nGiá vốn mới: ${formatNumber(newAvgPrice)}`);
    } else {
        // CASE B: Chưa có -> Thêm mới
        const newItem = { 
            id: Date.now(), 
            sym, 
            buyPrice: price, 
            vol: vol, 
            buyDate: new Date(), 
            // Tự động tạo Setup JIT giả định (có thể sửa sau)
            ent: price, 
            tg: price * 1.1, // Target +10%
            sl: price * 0.95 // SL -5%
        };
        portfolio.unshift(newItem);
    }

    saveState();
    closeModal('importModal');
}
// --- TRANSACTION LOGIC ---
function openTxModal(type, id) {
    const modal = document.getElementById('txModal');
    const title = document.getElementById('modalTitle');
    const btn = document.getElementById('txConfirmBtn');
    const item = type === 'buy' ? watchlist.find(i => i.id === id) : portfolio.find(i => i.id === id);
    
    if(!item) return;
    currentTx = { type, id, item };
    
    const mktPrice = mockMarketData[item.sym]?.price || 0;

    if(type === 'buy') {
        const res = calculateJIT(item);
        document.getElementById('txPrice').value = item.ent;
        document.getElementById('txVol').value = formatNumber(res.qSafe); 
        
        title.innerHTML = `<span class="text-sky-400">⚡ MUA</span> ${item.sym}`;
        btn.className = "w-full mt-6 py-3.5 rounded-lg text-sm font-bold uppercase shadow-lg bg-sky-600 hover:bg-sky-500 text-white";
        btn.onclick = executeBuy;
    } else {
        document.getElementById('txPrice').value = mktPrice || item.buyPrice;
        document.getElementById('txVol').value = formatNumber(item.vol);
        title.innerHTML = `<span class="text-rose-400">💰 BÁN</span> ${item.sym}`;
        btn.className = "w-full mt-6 py-3.5 rounded-lg text-sm font-bold uppercase shadow-lg bg-rose-600 hover:bg-rose-500 text-white";
        btn.onclick = executeSell;
    }
    modal.classList.add('open');
    updateTxCalc();
}

function executeBuy() {
    const price = parseFloat(document.getElementById('txPrice').value);
    const vol = parseNumber(document.getElementById('txVol').value);
    const totalCost = price * vol * 1000;
    
    if (cashBalance >= totalCost) {
        cashBalance -= totalCost;
    } else {
        const deficit = totalCost - cashBalance;
        cashBalance = 0; 
        marginDebt += deficit; 
    }

    const newItem = { ...currentTx.item, buyPrice: price, vol: vol, buyDate: new Date() };
    
    const existingIdx = portfolio.findIndex(p => p.sym === newItem.sym);
    if(existingIdx !== -1) {
        const oldItem = portfolio[existingIdx];
        const newVol = oldItem.vol + vol;
        const newAvgPrice = ((oldItem.buyPrice * oldItem.vol) + (price * vol)) / newVol;
        portfolio[existingIdx].vol = newVol;
        portfolio[existingIdx].buyPrice = parseFloat(newAvgPrice.toFixed(2));
    } else {
        portfolio.unshift(newItem);
    }
    
    logHistory('buy', currentTx.item.sym, price, vol);
    watchlist = watchlist.filter(i => i.id !== currentTx.id);

    saveState(); closeModal('txModal'); switchTab('portfolio');
}

function executeSell() {
    const price = parseFloat(document.getElementById('txPrice').value);
    const sellVol = parseNumber(document.getElementById('txVol').value);
    const totalRecieve = price * sellVol * 1000;

    if (marginDebt > 0) {
        if (totalRecieve >= marginDebt) {
            const surplus = totalRecieve - marginDebt;
            marginDebt = 0;
            cashBalance += surplus;
        } else {
            marginDebt -= totalRecieve;
        }
    } else {
        cashBalance += totalRecieve;
    }

    const itemIdx = portfolio.findIndex(i => i.id === currentTx.id);
    if(itemIdx !== -1) {
        if(sellVol >= portfolio[itemIdx].vol) {
            portfolio.splice(itemIdx, 1);
        } else {
            portfolio[itemIdx].vol -= sellVol;
        }
    }
    
    logHistory('sell', currentTx.item.sym, price, sellVol);
    saveState(); closeModal('txModal'); renderPortfolio();
}

function logHistory(type, sym, price, vol) {
    history.unshift({
        id: Date.now() + Math.random(), // Tạo ID duy nhất để xóa
        type, sym, price, vol,
        date: new Date().toLocaleString('vi-VN')
    });
    if(history.length > 50) history.pop(); // Giữ 50 lệnh gần nhất
    saveState(); // Lưu ngay lập tức
}

// --- 2. Thêm hàm Xóa từng dòng ---
function deleteHistoryItem(id) {
    if(confirm('Xóa dòng lịch sử này? (Tiền và CP sẽ không bị ảnh hưởng, chỉ xóa log)')) {
        history = history.filter(h => h.id !== id);
        saveState();
    }
}

// --- UI HELPERS ---
function switchTab(t) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${t}`).classList.add('active');
    document.getElementById(`tab-${t}`).classList.add('active');
}
function addToWatchlist() {
    const sym = document.getElementById('symbol').value.toUpperCase();
    const ent = parseFloat(document.getElementById('entry').value);
    const tg = parseFloat(document.getElementById('target').value);
    const sl = parseFloat(document.getElementById('stoploss').value);
    if(!sym || isNaN(ent)) return;
    watchlist.unshift({ id: Date.now(), sym, ent, tg, sl });
    saveState(); switchTab('watchlist'); simulatePrices();
}
function deleteItem(type, id) {
    // Cảnh báo kỹ trước khi xóa
    const msg = type === 'w' 
        ? 'Xóa mã này khỏi danh sách theo dõi?' 
        : 'CẢNH BÁO: Xóa mã khỏi danh mục sẽ KHÔNG hoàn lại tiền (Dùng để sửa sai). Bạn có chắc chắn?';

    if(confirm(msg)) {
        if(type === 'w') {
            watchlist = watchlist.filter(i => i.id !== id);
        } else if (type === 'p') {
            // Xóa khỏi Portfolio
            portfolio = portfolio.filter(i => i.id !== id);
        }
        saveState(); // Lưu và Render lại ngay
    }
}
function clearHistory() { if(confirm('Xóa lịch sử?')) { history = []; saveState(); } }
function updateTxCalc() {
    const p = parseFloat(document.getElementById('txPrice').value) || 0;
    const v = parseNumber(document.getElementById('txVol').value);
    document.getElementById('txTotalCalc').innerText = formatNumber(p * v * 1000) + " VND";
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); currentTx = null; }

function simulatePrices() {
    const allItems = [...watchlist, ...portfolio];
    allItems.forEach(item => {
        const randomChange = (Math.random() * 0.05) - 0.025; 
        const basePrice = item.buyPrice || item.ent;
        const fakePrice = basePrice * (1 + randomChange);
        mockMarketData[item.sym] = { 
            price: parseFloat(fakePrice.toFixed(2)), 
            change: (randomChange * 100).toFixed(2),
            color: fakePrice > basePrice ? 'text-up' : 'text-down' 
        };
    });
    updateDashboard(); renderWatchlist(); renderPortfolio(); renderHistory();
}

// --- CẬP NHẬT HÀM RENDER WATCHLIST ---
function renderWatchlist() { 
    const container = document.getElementById('watchlist-container');
    if(watchlist.length === 0) { container.innerHTML = `<div class="text-center text-slate-600 text-[10px] mt-10">Trống.</div>`; return; }
    
    container.innerHTML = watchlist.map(i => {
        const res = calculateJIT(i);
        const mkt = mockMarketData[i.sym] || { price: i.ent, change: 0, color: 'text-white' };
        const isBuyZone = mkt.price > 0 && mkt.price <= i.ent;
        
        return `<div class="glass-card p-4 rounded-xl border-l-4 ${isBuyZone ? 'border-emerald-500 bg-emerald-900/10' : 'border-slate-600 bg-[#1e293b]'} shadow relative mb-3 group">
            <button onclick="deleteItem('w', ${i.id})" class="absolute top-2 right-2 text-slate-600 hover:text-red-500 p-1 rounded transition">✕</button>

            <div class="flex justify-between items-start mb-2 pr-4">
                <div><span class="font-black text-white text-lg tracking-wide">${i.sym}</span><span class="text-[10px] text-slate-400 block mt-0.5">Entry: <b>${i.ent}</b> | SL: <b class="text-red-400">${i.sl}</b></span></div>
                <div class="text-right"><div class="text-lg font-bold ${mkt.color}">${mkt.price}</div><div class="text-[10px] ${mkt.change>=0?'text-emerald-400':'text-red-400'}">${mkt.change}%</div></div>
            </div>
            
            ${isBuyZone ? `<div class="mb-2 text-center text-[10px] font-bold text-emerald-400 animate-pulse bg-emerald-900/50 rounded py-1">⚡ GIÁ VỀ VÙNG MUA!</div>` : ''}
            
            <div class="bg-black/20 rounded p-2 grid grid-cols-2 gap-2 mb-3 border border-slate-700/50">
                <div><span class="block text-[9px] text-slate-500 uppercase">KL Khuyến nghị</span><span class="font-bold text-yellow-400 text-sm">${formatNumber(res.qSafe)}</span></div>
                <div class="text-right"><span class="block text-[9px] text-slate-500 uppercase">Giá trị</span><span class="font-bold text-sky-400 text-sm">${formatNumber(res.totalValue)}</span></div>
            </div>
            
            <button onclick="openTxModal('buy', ${i.id})" class="w-full bg-sky-700 hover:bg-sky-600 text-white text-[10px] font-bold py-2 rounded shadow">⚡ KHỚP MUA</button>
        </div>`;
    }).join('');
}
// --- CẬP NHẬT HÀM RENDER PORTFOLIO ---
function renderPortfolio() {
    const container = document.getElementById('portfolio-container');
    if(portfolio.length === 0) { container.innerHTML = `<div class="text-center text-slate-600 text-[10px] mt-10">Trống.</div>`; return; }
    
    container.innerHTML = portfolio.map(i => {
        const mkt = mockMarketData[i.sym] || { price: i.buyPrice, color: 'text-white' };
        const pnl = (mkt.price - i.buyPrice) * i.vol * 1000;
        const pnlPer = ((mkt.price - i.buyPrice)/i.buyPrice)*100;
        
        return `<div class="glass-card p-4 rounded-xl bg-[#131c31] border-l-4 ${pnl >= 0 ? 'border-emerald-500' : 'border-rose-500'} shadow mb-3 relative group">
            
            <button onclick="deleteItem('p', ${i.id})" class="absolute top-2 right-2 text-slate-700 hover:text-red-500 p-1 transition" title="Xóa mã (Sửa sai)">✕</button>

            <div class="flex justify-between items-center mb-2 pr-6">
                <span class="font-black text-white text-xl">${i.sym}</span>
                <div class="text-right">
                    <span class="text-sm font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${pnl>0?'+':''}${formatNumber(pnl)}</span>
                    <span class="block text-[9px] text-slate-500">${pnlPer.toFixed(2)}%</span>
                </div>
            </div>
            
            <div class="grid grid-cols-3 gap-2 text-[10px] text-slate-400 bg-black/20 p-2 rounded mb-2 border border-slate-700/50">
                <div class="text-center">Giá Vốn<br><b class="text-white">${i.buyPrice}</b></div>
                <div class="text-center border-l border-slate-700">KL<br><b class="text-white">${formatNumber(i.vol)}</b></div>
                <div class="text-center border-l border-slate-700">Thị trường<br><b class="${mkt.color}">${mkt.price}</b></div>
            </div>
            
            <button onclick="openTxModal('sell', ${i.id})" class="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] font-bold py-2 rounded uppercase">CHỐT / CẮT</button>
        </div>`;
    }).join('');
}
renderHistory
