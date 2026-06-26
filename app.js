const stocks = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "Energy",
    price: 2918.45,
    change: 1.24,
    volume: "8.2M",
    signal: "BUY",
    confidence: 82,
    support: 2840,
    resistance: 2965,
    reason: "Breakout above 20-day average with strong delivery volume.",
    trend: [2832, 2845, 2860, 2853, 2874, 2892, 2888, 2904, 2918],
  },
  {
    symbol: "TCS",
    name: "Tata Consultancy Services",
    sector: "IT",
    price: 3924.1,
    change: 0.46,
    volume: "2.1M",
    signal: "HOLD",
    confidence: 68,
    support: 3865,
    resistance: 3980,
    reason: "Stable uptrend, but price is close to short-term resistance.",
    trend: [3868, 3882, 3890, 3912, 3904, 3920, 3914, 3936, 3924],
  },
  {
    symbol: "HDFCBANK",
    name: "HDFC Bank",
    sector: "Banking",
    price: 1668.75,
    change: -0.32,
    volume: "12.4M",
    signal: "HOLD",
    confidence: 61,
    support: 1642,
    resistance: 1698,
    reason: "Banking momentum is mixed; wait for confirmation above resistance.",
    trend: [1698, 1686, 1678, 1660, 1654, 1662, 1658, 1672, 1669],
  },
  {
    symbol: "INFY",
    name: "Infosys",
    sector: "IT",
    price: 1542.3,
    change: 1.08,
    volume: "5.8M",
    signal: "BUY",
    confidence: 76,
    support: 1506,
    resistance: 1574,
    reason: "IT pack is recovering and RSI leaves room before overbought zone.",
    trend: [1498, 1508, 1510, 1526, 1518, 1532, 1538, 1546, 1542],
  },
  {
    symbol: "MARUTI",
    name: "Maruti Suzuki",
    sector: "Auto",
    price: 12440.0,
    change: 0.84,
    volume: "680K",
    signal: "BUY",
    confidence: 74,
    support: 12120,
    resistance: 12680,
    reason: "Auto sector breadth is positive with a clean higher-low structure.",
    trend: [12080, 12140, 12210, 12190, 12320, 12384, 12410, 12474, 12440],
  },
  {
    symbol: "ITC",
    name: "ITC",
    sector: "FMCG",
    price: 438.2,
    change: -0.76,
    volume: "9.6M",
    signal: "SELL",
    confidence: 64,
    support: 432,
    resistance: 448,
    reason: "Weak close below intraday VWAP; avoid fresh entry until recovery.",
    trend: [449, 447, 446, 444, 442, 441, 439, 440, 438],
  },
];

const elements = {
  searchInput: document.querySelector("#searchInput"),
  refreshBtn: document.querySelector("#refreshBtn"),
  signalList: document.querySelector("#signalList"),
  stockTable: document.querySelector("#stockTable"),
  sectorFilter: document.querySelector("#sectorFilter"),
  ticketSymbol: document.querySelector("#ticketSymbol"),
  quantityInput: document.querySelector("#quantityInput"),
  lossInput: document.querySelector("#lossInput"),
  capitalValue: document.querySelector("#capitalValue"),
  stopValue: document.querySelector("#stopValue"),
  chartTitle: document.querySelector("#chartTitle"),
  chart: document.querySelector("#priceChart"),
};

let selectedSymbol = "RELIANCE";

function formatRupee(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value > 1000 ? 0 : 2,
  }).format(value);
}

function filteredStocks() {
  const sector = elements.sectorFilter.value;
  const query = elements.searchInput.value.trim().toLowerCase();
  return stocks.filter((stock) => {
    const matchesSector = sector === "all" || stock.sector === sector;
    const matchesQuery = !query || `${stock.symbol} ${stock.name} ${stock.sector}`.toLowerCase().includes(query);
    return matchesSector && matchesQuery;
  });
}

function selectedStock() {
  return stocks.find((stock) => stock.symbol === selectedSymbol) || stocks[0];
}

function signalClass(signal) {
  return signal.toLowerCase();
}

function renderSignals() {
  const topSignals = [...stocks].sort((a, b) => b.confidence - a.confidence).slice(0, 4);
  elements.signalList.innerHTML = "";

  topSignals.forEach((stock) => {
    const card = document.createElement("article");
    card.className = "signal-card";
    card.innerHTML = `
      <header>
        <div>
          <h3>${stock.symbol}</h3>
          <p>${stock.name}</p>
        </div>
        <span class="signal-badge ${signalClass(stock.signal)}">${stock.signal}</span>
      </header>
      <p>${stock.reason}</p>
      <div class="chart-meta">
        <span>${stock.confidence}% confidence</span>
        <span>SL ${formatRupee(stock.support)}</span>
      </div>
    `;
    card.addEventListener("click", () => selectStock(stock.symbol));
    elements.signalList.appendChild(card);
  });
}

function renderTable() {
  const list = filteredStocks();
  elements.stockTable.innerHTML = `
    <div class="stock-row header">
      <span>Stock</span>
      <span>Sector</span>
      <span>Price</span>
      <span>Change</span>
      <span>Volume</span>
      <span>Signal</span>
    </div>
  `;

  list.forEach((stock) => {
    const row = document.createElement("button");
    row.className = "stock-row";
    row.type = "button";
    row.innerHTML = `
      <span class="stock-name"><strong>${stock.symbol}</strong><small>${stock.name}</small></span>
      <span>${stock.sector}</span>
      <span>${formatRupee(stock.price)}</span>
      <span class="${stock.change >= 0 ? "up" : "down"}">${stock.change >= 0 ? "+" : ""}${stock.change}%</span>
      <span>${stock.volume}</span>
      <span><em class="signal-badge ${signalClass(stock.signal)}">${stock.signal}</em></span>
    `;
    row.addEventListener("click", () => selectStock(stock.symbol));
    elements.stockTable.appendChild(row);
  });

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "signal-card";
    empty.textContent = "No stocks match this search or sector filter.";
    elements.stockTable.appendChild(empty);
  }
}

function renderTicketOptions() {
  elements.ticketSymbol.innerHTML = stocks
    .map((stock) => `<option value="${stock.symbol}">${stock.symbol} - ${stock.name}</option>`)
    .join("");
  elements.ticketSymbol.value = selectedSymbol;
}

function updateTicket() {
  const stock = selectedStock();
  const qty = Math.max(1, Number(elements.quantityInput.value) || 1);
  const maxLoss = Math.max(100, Number(elements.lossInput.value) || 100);
  const stopDistance = maxLoss / qty;
  elements.capitalValue.textContent = formatRupee(stock.price * qty);
  elements.stopValue.textContent = formatRupee(Math.max(0, stock.price - stopDistance));
}

function drawChart() {
  const stock = selectedStock();
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = Math.max(600, Math.floor(rect.width * dpr));
  canvas.height = Math.max(260, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const pad = 28;
  const data = stock.trend;
  const min = Math.min(...data) * 0.997;
  const max = Math.max(...data) * 1.003;
  const xStep = (width - pad * 2) / (data.length - 1);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = pad + ((height - pad * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const points = data.map((value, index) => {
    const x = pad + xStep * index;
    const y = height - pad - ((value - min) / (max - min)) * (height - pad * 2);
    return { x, y };
  });

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, "rgba(20, 184, 166, 0.28)");
  gradient.addColorStop(1, "rgba(20, 184, 166, 0)");

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points[points.length - 1].x, height - pad);
  ctx.lineTo(points[0].x, height - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = stock.change >= 0 ? "#0f766e" : "#dc2626";
  ctx.lineWidth = 3;
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = stock.change >= 0 ? "#0f766e" : "#dc2626";
  ctx.fill();

  ctx.fillStyle = "#64748b";
  ctx.font = "700 12px Inter, sans-serif";
  ctx.fillText(formatRupee(max), pad, 18);
  ctx.fillText(formatRupee(min), pad, height - 10);
}

function selectStock(symbol) {
  selectedSymbol = symbol;
  const stock = selectedStock();
  elements.chartTitle.textContent = stock.name;
  elements.ticketSymbol.value = stock.symbol;
  updateTicket();
  drawChart();
}

function simulateRefresh() {
  elements.refreshBtn.textContent = "Fetching...";
  elements.refreshBtn.disabled = true;
  window.setTimeout(() => {
    elements.refreshBtn.textContent = "Refresh Data";
    elements.refreshBtn.disabled = false;
    renderAll();
  }, 650);
}

function renderAll() {
  renderSignals();
  renderTable();
  renderTicketOptions();
  selectStock(selectedSymbol);
}

elements.searchInput.addEventListener("input", renderTable);
elements.sectorFilter.addEventListener("change", renderTable);
elements.ticketSymbol.addEventListener("change", (event) => selectStock(event.target.value));
elements.quantityInput.addEventListener("input", updateTicket);
elements.lossInput.addEventListener("input", updateTicket);
elements.refreshBtn.addEventListener("click", simulateRefresh);
window.addEventListener("resize", drawChart);

document.querySelectorAll(".action-toggle button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".action-toggle button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});

renderAll();
