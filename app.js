// MARK: - Catálogo de Activos y Metadatos (100% Anónimo y Neutro)
const COIN_META = {
  "BTC": { name: "Bitcoin", icon: "₿", color: "#F3BA2F", source: "binance" },
  "ADA": { name: "Cardano", icon: "₳", color: "#00D2D3", source: "binance" },
  "ETH": { name: "Ethereum", icon: "Ξ", color: "#9B7DFF", source: "binance" },
  "SOL": { name: "Solana", icon: "S", color: "#14F195", source: "binance" },
  "XRP": { name: "Ripple", icon: "X", color: "#23292F", source: "binance" },
  "EGLN": { name: "Oro Físico", icon: "🪙", color: "#FFD700", source: "yahoo", yahoo_sym: "IGLN.L", yahoo_sym_eur: "PPFB.DE" },
  "IGLN": { name: "Oro Físico", icon: "🪙", color: "#FFD700", source: "yahoo", yahoo_sym: "IGLN.L", yahoo_sym_eur: "PPFB.DE" },
  "GOOGL": { name: "Google", icon: "G", color: "#4285F4", source: "yahoo", yahoo_sym: "GOOGL", yahoo_sym_eur: "ABEA.DE" }
};

// MARK: - Estado de la Aplicación
let currentCurrency = localStorage.getItem("preferred_currency") || "EUR";
let pcHost = localStorage.getItem("pc_server_ip") || "192.168.1.128:8765";
let positions = JSON.parse(localStorage.getItem("saved_positions") || "[]");
let selectedSymbol = null;
let eurUsdRate = 1.08;
let livePricesUSD = {};
let isSyncing = false;
let updateTimer = null;

// Elementos del DOM
const statusDot = document.getElementById("statusDot");
const btnCurrency = document.getElementById("btnCurrency");
const btnSync = document.getElementById("btnSync");
const btnSettings = document.getElementById("btnSettings");
const donutSlices = document.getElementById("donutSlices");
const donutCenter = document.getElementById("donutCenter");
const globalCenterView = document.getElementById("globalCenterView");
const selectedCenterView = document.getElementById("selectedCenterView");
const totalValueEl = document.getElementById("totalValue");
const totalPnlBadgeEl = document.getElementById("totalPnlBadge");
const selCoinNameEl = document.getElementById("selCoinName");
const selDotEl = document.getElementById("selDot");
const selShareEl = document.getElementById("selShare");
const selValEl = document.getElementById("selVal");
const selInvEl = document.getElementById("selInv");
const selPnlBadgeEl = document.getElementById("selPnlBadge");
const assetsGrid = document.getElementById("assetsGrid");

// Modal
const settingsModal = document.getElementById("settingsModal");
const btnCloseSettings = document.getElementById("btnCloseSettings");
const pcIpInput = document.getElementById("pcIpInput");
const btnModalSync = document.getElementById("btnModalSync");
const btnShowAddCoin = document.getElementById("btnShowAddCoin");
const addCoinForm = document.getElementById("addCoinForm");
const btnSaveCoin = document.getElementById("btnSaveCoin");
const positionsList = document.getElementById("positionsList");

// MARK: - Inicialización
function init() {
  // 1. Service Worker para modo offline PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 2. Cargar IP guardada
  pcIpInput.value = pcHost;

  // 3. Configurar botón de divisa
  updateCurrencyButtonText();

  // 4. Listeners
  btnCurrency.addEventListener("click", toggleCurrency);
  btnSync.addEventListener("click", () => syncWithPC(true));
  donutCenter.addEventListener("click", deselectAsset);
  btnSettings.addEventListener("click", openSettings);
  btnCloseSettings.addEventListener("click", closeSettings);
  btnModalSync.addEventListener("click", () => {
    pcHost = pcIpInput.value.trim() || "192.168.1.128:8765";
    localStorage.setItem("pc_server_ip", pcHost);
    syncWithPC(true);
  });
  btnShowAddCoin.addEventListener("click", () => {
    addCoinForm.classList.toggle("hidden");
  });
  btnSaveCoin.addEventListener("click", saveCustomCoin);

  // 5. Si ya hay posiciones guardadas, actualizar precios
  if (positions.length > 0) {
    statusDot.classList.remove("offline");
    fetchLivePrices();
  } else {
    // Si no hay posiciones guardadas, intentar sincronización inicial silenciosa con el PC
    statusDot.classList.add("offline");
    syncWithPC(false);
  }

  // 6. Temporizador automático cada 15 segundos
  clearInterval(updateTimer);
  updateTimer = setInterval(fetchLivePrices, 15000);
}

// MARK: - Conmutador EUR <-> USD Instantáneo (0ms)
function toggleCurrency() {
  currentCurrency = (currentCurrency === "EUR") ? "USD" : "EUR";
  localStorage.setItem("preferred_currency", currentCurrency);
  updateCurrencyButtonText();
  render();
}

function updateCurrencyButtonText() {
  btnCurrency.textContent = (currentCurrency === "EUR") ? "€ EUR" : "$ USD";
}

// Conversión de Divisas
function convertAmount(amount, fromCurr, toCurr) {
  if (fromCurr === toCurr) return amount;
  if (fromCurr === "EUR" && toCurr === "USD") return amount * eurUsdRate;
  if (fromCurr === "USD" && toCurr === "EUR") return eurUsdRate > 0 ? (amount / eurUsdRate) : amount;
  return amount;
}

// Formateo de Precios y Valores
function formatCurrency(val, currency = currentCurrency) {
  const sym = (currency === "EUR") ? "€" : "$";
  return new Intl.NumberFormat(currency === "EUR" ? "es-ES" : "en-US", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(val);
}

function formatMarketPrice(val, currency = currentCurrency) {
  if (!val || val <= 0) return "—";
  let maxDec = 2;
  let minDec = 2;
  if (val >= 1000) {
    maxDec = 0;
    minDec = 0;
  } else if (val < 0.01) {
    maxDec = 4;
    minDec = 2;
  } else if (val < 1) {
    maxDec = 3;
    minDec = 2;
  }

  return new Intl.NumberFormat(currency === "EUR" ? "es-ES" : "en-US", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: maxDec,
    minimumFractionDigits: minDec
  }).format(val);
}

// MARK: - Actualización de Precios en Vivo (Binance + Yahoo)
async function fetchLivePrices() {
  if (positions.length === 0) {
    render();
    return;
  }

  try {
    // 1. Ticker EUR/USDT para tasa exacta
    try {
      const rateRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT", { cache: "no-store" });
      if (rateRes.ok) {
        const rateData = await rateRes.json();
        const r = parseFloat(rateData.price);
        if (r > 0) eurUsdRate = r;
      }
    } catch (_) {}

    // 2. Precios de Criptomonedas desde Binance (CORS 100% abierto)
    const uniqueCoins = [...new Set(positions.map(p => p.coin))];
    const fetchPromises = uniqueCoins.map(async (coin) => {
      const meta = COIN_META[coin] || { source: "binance" };
      if (meta.source === "binance") {
        try {
          const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${coin}USDT`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            const p = parseFloat(data.price);
            if (p > 0) livePricesUSD[coin] = p;
          }
        } catch (_) {}
      } else if (meta.source === "yahoo") {
        // Yahoo Finance chart API
        const ySym = meta.yahoo_sym || coin;
        try {
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=15m&range=1d`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (price > 0) livePricesUSD[coin] = price;
          }
        } catch (_) {}
      }
    });

    await Promise.all(fetchPromises);
    statusDot.classList.remove("offline");
    render();
  } catch (err) {
    console.warn("Error consultando precios en vivo:", err);
  }
}

// MARK: - Sincronización con el PC (Wi-Fi Local)
async function syncWithPC(isManual = false) {
  if (isSyncing) return;
  isSyncing = true;
  btnSync.classList.add("spinning");

  const targetHost = pcHost.replace(/^http:\/\//, "");
  const url = `http://${targetHost}/api/portfolio`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.positions && data.positions.length > 0) {
        positions = data.positions;
        localStorage.setItem("saved_positions", JSON.stringify(positions));
        statusDot.classList.remove("offline");
        await fetchLivePrices();
        if (isManual) {
          closeSettings();
        }
      }
    }
  } catch (e) {
    if (isManual) {
      alert("No se pudo conectar con el PC en " + targetHost + ".\nAsegúrate de que el Market Widget esté abierto en el ordenador y en la misma red Wi-Fi.");
    }
  } finally {
    isSyncing = false;
    btnSync.classList.remove("spinning");
  }
}

// MARK: - Motor de Renderizado Visual
function render() {
  if (positions.length === 0) {
    renderEmptyState();
    return;
  }

  const targetCurr = currentCurrency;
  let totalInvested = 0;
  let totalCurrentVal = 0;
  const coinTotals = {};

  // Calcular agregados de cada moneda
  positions.forEach(pos => {
    const ck = pos.coin;
    const inv = convertAmount(pos.invested, pos.currency, targetCurr);
    const ep = convertAmount(pos.entry_price, pos.currency, targetCurr);

    let livePriceInTarget = ep;
    if (livePricesUSD[ck]) {
      livePriceInTarget = convertAmount(livePricesUSD[ck], "USD", targetCurr);
    }

    const curVal = (ep > 0) ? (inv * (livePriceInTarget / ep)) : inv;

    totalInvested += inv;
    totalCurrentVal += curVal;

    if (!coinTotals[ck]) {
      const meta = COIN_META[ck] || { name: ck, icon: "◆", color: "#F3BA2F" };
      coinTotals[ck] = {
        symbol: ck,
        name: meta.name,
        color: meta.color,
        invested: 0,
        value: 0,
        current_price: livePriceInTarget
      };
    }

    coinTotals[ck].invested += inv;
    coinTotals[ck].value += curVal;
    coinTotals[ck].current_price = livePriceInTarget;
  });

  const totalPnl = totalCurrentVal - totalInvested;
  const totalPnlPct = (totalInvested > 0) ? ((totalPnl / totalInvested) * 100) : 0;

  // Lista de activos ordenados por valor
  const items = Object.values(coinTotals).sort((a, b) => b.value - a.value);
  items.forEach(item => {
    item.pnl = item.value - item.invested;
    item.pnl_pct = (item.invested > 0) ? ((item.pnl / item.invested) * 100) : 0;
    item.share_pct = (totalCurrentVal > 0) ? ((item.value / totalCurrentVal) * 100) : 0;
  });

  // 1. Actualizar Centro del Donut
  if (selectedSymbol && coinTotals[selectedSymbol]) {
    const sel = coinTotals[selectedSymbol];
    globalCenterView.classList.add("hidden");
    selectedCenterView.classList.remove("hidden");

    selCoinNameEl.textContent = sel.symbol;
    selDotEl.style.color = sel.color;
    selShareEl.textContent = sel.share_pct.toFixed(1) + "%";
    selValEl.textContent = formatCurrency(sel.value, targetCurr);
    selInvEl.textContent = "Inv: " + formatCurrency(sel.invested, targetCurr);

    selPnlBadgeEl.textContent = (sel.pnl_pct >= 0 ? "+" : "") + sel.pnl_pct.toFixed(1) + "%";
    selPnlBadgeEl.className = "center-badge " + (sel.pnl_pct >= 0 ? "badge-green" : "badge-red");
  } else {
    selectedCenterView.classList.add("hidden");
    globalCenterView.classList.remove("hidden");

    totalValueEl.textContent = formatCurrency(totalCurrentVal, targetCurr);
    const sign = totalPnl >= 0 ? "+" : "-";
    totalPnlBadgeEl.textContent = `${sign}${formatCurrency(Math.abs(totalPnl), targetCurr)} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)`;
    totalPnlBadgeEl.className = "center-badge " + (totalPnlPct >= 0 ? "badge-green" : "badge-red");
  }

  // 2. Dibujar Segmentos SVG del Donut
  renderDonutChart(items);

  // 3. Dibujar Cuadrícula de 2 Columnas
  renderGrid(items, targetCurr);

  // 4. Actualizar lista del modal de ajustes
  renderPositionsList();
}

function renderEmptyState() {
  donutSlices.innerHTML = "";
  totalValueEl.textContent = "0 €";
  totalPnlBadgeEl.textContent = "Sin Datos";
  totalPnlBadgeEl.className = "center-badge badge-neutral";
  assetsGrid.innerHTML = `
    <div style="grid-column: span 2; text-align: center; padding: 24px 12px; color: var(--text-dim);">
      <p style="font-weight: 700; margin-bottom: 6px; font-size: 15px;">Conecta con tu PC</p>
      <p style="font-size: 12px; margin-bottom: 14px;">Pulsa el botón de actualizar arriba para traer tus monedas.</p>
      <button onclick="syncWithPC(true)" class="pill-btn" style="margin: 0 auto; padding: 0 16px;">🔄 Sincronizar Ahora</button>
    </div>
  `;
}

// MARK: - Generador SVG del Donut
function renderDonutChart(items) {
  donutSlices.innerHTML = "";
  const radius = 78;
  const circumference = 2 * Math.PI * radius; // ~490.088
  let currentOffset = 0;

  items.forEach(item => {
    if (item.share_pct <= 0.4) return;

    const arcLength = (item.share_pct / 100) * circumference;
    const gap = (items.length > 1) ? 2 : 0;
    const strokeDash = `${Math.max(0, arcLength - gap)} ${circumference}`;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "100");
    circle.setAttribute("cy", "100");
    circle.setAttribute("r", radius.toString());
    circle.setAttribute("stroke", item.color);
    circle.setAttribute("stroke-dasharray", strokeDash);
    circle.setAttribute("stroke-dashoffset", (-currentOffset).toString());

    let classes = "donut-slice";
    if (selectedSymbol) {
      if (selectedSymbol === item.symbol) {
        classes += " selected";
      } else {
        classes += " dimmed";
      }
    }
    circle.setAttribute("class", classes);

    circle.addEventListener("click", (e) => {
      e.stopPropagation();
      selectAsset(item.symbol);
    });

    donutSlices.appendChild(circle);
    currentOffset += arcLength;
  });
}

// MARK: - Generador de la Cuadrícula en 2 Columnas
function renderGrid(items, targetCurr) {
  assetsGrid.innerHTML = "";

  items.forEach(item => {
    const isSelected = (selectedSymbol === item.symbol);
    const pnlSign = item.pnl_pct >= 0 ? "+" : "";
    const pnlClass = item.pnl_pct >= 0 ? "badge-green" : "badge-red";

    const card = document.createElement("div");
    card.className = "asset-card" + (isSelected ? " selected" : "");
    if (isSelected) {
      card.style.borderColor = item.color;
    }

    card.innerHTML = `
      <div class="card-row-top">
        <div class="card-coin-id">
          <span class="coin-dot" style="background-color: ${item.color};"></span>
          <span class="coin-symbol">${item.symbol}</span>
        </div>
        <span class="card-badge ${pnlClass}">${pnlSign}${item.pnl_pct.toFixed(1)}%</span>
      </div>
      <div class="card-price">${formatMarketPrice(item.current_price, targetCurr)}</div>
    `;

    card.addEventListener("click", () => selectAsset(item.symbol));
    assetsGrid.appendChild(card);
  });
}

// Selección interactiva
function selectAsset(symbol) {
  if (selectedSymbol === symbol) {
    selectedSymbol = null;
  } else {
    selectedSymbol = symbol;
  }
  render();
}

function deselectAsset() {
  if (selectedSymbol) {
    selectedSymbol = null;
    render();
  }
}

// MARK: - Modal de Ajustes
function openSettings() {
  settingsModal.classList.remove("hidden");
  renderPositionsList();
}

function closeSettings() {
  settingsModal.classList.add("hidden");
  addCoinForm.classList.add("hidden");
}

function renderPositionsList() {
  positionsList.innerHTML = "";
  if (positions.length === 0) {
    positionsList.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">No tienes monedas añadidas.</span>`;
    return;
  }

  positions.forEach((pos, idx) => {
    const item = document.createElement("div");
    item.className = "pos-item";
    item.innerHTML = `
      <div class="pos-info">
        <span class="pos-sym">${pos.coin}</span>
        <span class="pos-sub">Inv: ${pos.invested} ${pos.currency} • Compra: ${pos.entry_price}</span>
      </div>
      <button class="pos-delete-btn" onclick="deletePosition(${idx})">Eliminar</button>
    `;
    positionsList.appendChild(item);
  });
}

window.deletePosition = function(idx) {
  positions.splice(idx, 1);
  localStorage.setItem("saved_positions", JSON.stringify(positions));
  render();
};

function saveCustomCoin() {
  const sym = document.getElementById("newCoinSymbol").value.trim().toUpperCase();
  const inv = parseFloat(document.getElementById("newCoinInv").value);
  const ep = parseFloat(document.getElementById("newCoinEp").value);
  const curr = document.getElementById("newCoinCurrency").value;
  const src = document.getElementById("newCoinSource").value;

  if (!sym || isNaN(inv) || isNaN(ep) || inv <= 0 || ep <= 0) {
    alert("Por favor introduce datos válidos.");
    return;
  }

  const meta = COIN_META[sym] || { name: sym, icon: "◆", color: "#F3BA2F" };
  positions.push({
    coin: sym,
    name: meta.name,
    icon: meta.icon,
    color: meta.color,
    source: src,
    invested: inv,
    entry_price: ep,
    currency: curr
  });

  localStorage.setItem("saved_positions", JSON.stringify(positions));
  document.getElementById("newCoinSymbol").value = "";
  document.getElementById("newCoinInv").value = "";
  document.getElementById("newCoinEp").value = "";
  addCoinForm.classList.add("hidden");

  render();
  fetchLivePrices();
}

// Iniciar aplicación
document.addEventListener("DOMContentLoaded", init);
