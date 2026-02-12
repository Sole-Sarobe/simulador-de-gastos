// js/app.js

// ================================
// Storage
// ================================
const STORAGE_KEYS = {
  income: "sim_gastos_income",
  expenses: "sim_gastos_expenses",
};

function loadIncome() {
  const raw = localStorage.getItem(STORAGE_KEYS.income);
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function saveIncome(value) {
  localStorage.setItem(STORAGE_KEYS.income, String(value));
}

function loadExpenses() {
  const raw = localStorage.getItem(STORAGE_KEYS.expenses);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveExpenses(expenses) {
  localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
}

// ================================
// State
// ================================
let income = loadIncome();
let expenses = loadExpenses();

// FX cache (para no pegarle a la API todo el tiempo)
let fx = {
  casa: "oficial",
  compra: null,
  venta: null,
  fechaActualizacion: null,
  ts: 0,
};

// ================================
// DOM refs
// ================================
const incomeForm = document.getElementById("incomeForm");
const incomeInput = document.getElementById("incomeInput");
const incomeMsg = document.getElementById("incomeMsg");

const expenseForm = document.getElementById("expenseForm");
const categorySelect = document.getElementById("categorySelect");
const amountInput = document.getElementById("amountInput");
const descInput = document.getElementById("descInput");
const expenseMsg = document.getElementById("expenseMsg");

const currencySelect = document.getElementById("currencySelect");
const dolarCasaSelect = document.getElementById("dolarCasaSelect");
const fxInfo = document.getElementById("fxInfo");

const kpiIncome = document.getElementById("kpiIncome");
const kpiSpent = document.getElementById("kpiSpent");
const kpiBalance = document.getElementById("kpiBalance");

const statusMsg = document.getElementById("statusMsg");
const categoryTotalsUl = document.getElementById("categoryTotals");
const rankingOl = document.getElementById("rankingList");

const expensesList = document.getElementById("expensesList");
const clearBtn = document.getElementById("clearBtn");

const fxBox = document.getElementById("fxBox");
const fxInfoWrap = document.getElementById("fxInfoWrap");

// ================================
// UI Helpers (Toast / Msg)
// ================================
function toast(text, type = "info") {
  const isErr = type === "err";
  Toastify({
    text,
    duration: 2500,
    gravity: "bottom",
    position: "right",
    style: {
      background: isErr ? "linear-gradient(135deg, #FF3B3B, #FF7C7C)" : "linear-gradient(135deg, #2737ff, #6a77ff)",
    },
  }).showToast();
}

function setMsg(el, text, type) {
  el.textContent = text;
  el.className = "msg" + (type ? ` ${type}` : "");
}

// ================================
// Utils
// ================================
function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function totalSpentARS() {
  return expenses.reduce((acc, g) => acc + Number(g.amountARS || 0), 0);
}

function balanceARS() {
  return income - totalSpentARS();
}

function buildTotalsByCategoryARS() {
  const totals = {};
  for (const g of expenses) {
    const a = Number(g.amountARS || 0);
    totals[g.category] = (totals[g.category] || 0) + a;
  }
  return totals;
}

function formatUSD(n) {
  const num = Number(n || 0);
  return "U$S " + num.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function expenseToARS(amount, currency) {
  if (currency === "ARS") return amount;

  // USD -> ARS usando VENTA 
  if (!Number.isFinite(fx.venta)) return NaN;
  return amount * fx.venta;
}
function updateFxVisibility() {
  const isUSD = currencySelect.value === "USD";

  fxBox.classList.toggle("show", isUSD);
  fxInfoWrap.classList.toggle("show", isUSD);

  
  if (!isUSD) {
    setMsg(expenseMsg, "", "");
  }
}


// ================================
// Remote data: categorías (JSON local)
// ================================
async function loadCategories() {
  try {
    const res = await fetch("data/categories.json", { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudieron cargar categorías.");
    const cats = await res.json();

    categorySelect.innerHTML = `<option value="" selected disabled>Elegí una</option>`;
    if (!Array.isArray(cats) || cats.length === 0) {
      const opt = document.createElement("option");
      opt.value = "Otros";
      opt.textContent = "Otros";
      categorySelect.appendChild(opt);
      return;
    }

    cats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categorySelect.appendChild(opt);
    });
  } catch {
    categorySelect.innerHTML = `
      <option value="" selected disabled>Elegí una</option>
      <option value="Otros">Otros</option>
    `;
    toast("No se pudo cargar categories.json, usando fallback.", "err");
  }
}

// ================================
// Remote data: dólar (API)
// ================================
async function fetchDolarCasa(casa) {
  const url = `https://dolarapi.com/v1/dolares/${encodeURIComponent(casa)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo obtener la cotización.");
  return res.json();
}

async function refreshFx(force = false) {
  const casa = dolarCasaSelect.value || "oficial";
  const maxAgeMs = 5 * 60 * 1000; // 5 min
  const now = Date.now();

  if (!force && fx.casa === casa && fx.ts && (now - fx.ts) < maxAgeMs && Number.isFinite(fx.venta)) {
    // Cache vigente
    renderFxInfo();
    return;
  }

  try {
    const data = await fetchDolarCasa(casa);

    fx = {
      casa: data.casa || casa,
      compra: Number(data.compra),
      venta: Number(data.venta),
      fechaActualizacion: data.fechaActualizacion || null,
      ts: now,
    };

    renderFxInfo();
  } catch {
    fx = { casa, compra: null, venta: null, fechaActualizacion: null, ts: now };
    renderFxInfo(true);
    toast("No se pudo traer el dólar. Igual podés cargar gastos en ARS.", "err");
  }
}

function renderFxInfo(isError = false) {
  if (isError || !Number.isFinite(fx.venta)) {
    fxInfo.textContent = "Cotización: no disponible (USD deshabilitado hasta recargar).";
    return;
  }

  const act = fx.fechaActualizacion ? `Act: ${fx.fechaActualizacion}` : "Act: —";
  fxInfo.textContent = `Cotización (${fx.casa}) — Compra: ${money(fx.compra)} | Venta: ${money(fx.venta)} | ${act}`;
}

// ================================
// Render
// ================================
function renderKPIs() {
  kpiIncome.textContent = money(income);
  const spent = totalSpentARS();
  kpiSpent.textContent = money(spent);
  kpiBalance.textContent = money(income - spent);
}

function renderStatus() {
  const bal = balanceARS();
  const spent = totalSpentARS();

  if (income <= 0) {
    statusMsg.textContent = "Primero cargá tu ingreso mensual para poder controlar límites y saldo.";
    return;
  }

  if (bal < 0) {
    statusMsg.textContent = "Te pasaste: tus gastos superan tu ingreso.";

    
    Swal.fire({
      icon: "error",
      title: "Te pasaste...",
      text: "Tus gastos superan tus ingresos.",
      footer: "Revisá el ingreso o reducí gastos",
    });

  } else if (bal === 0 && spent > 0) {
    statusMsg.textContent = "Gastaste exactamente tu ingreso. Saldo en cero.";
  } else if (bal < income * 0.2) {
    statusMsg.textContent = "Estás justo: te queda menos del 20% de tu ingreso.";
  } else {
    statusMsg.textContent = "Vas bien: todavía te queda un margen cómodo.";
  }
}

function renderCategoryTotalsAndRanking() {
  const totals = buildTotalsByCategoryARS();
  const pairs = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  // Totales por categoría (UL)
  categoryTotalsUl.innerHTML = "";
  if (pairs.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Todavía no hay gastos cargados.";
    categoryTotalsUl.appendChild(li);
  } else {
    for (const [cat, amt] of pairs) {
      const li = document.createElement("li");
      li.textContent = `${cat}: ${money(amt)}`;
      categoryTotalsUl.appendChild(li);
    }
  }

  // Ranking (OL)
  rankingOl.innerHTML = "";
  if (pairs.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Sin ranking aún.";
    rankingOl.appendChild(li);
  } else {
    pairs.forEach(([cat, amt], idx) => {
      const li = document.createElement("li");
      const medal = idx === 0 ? "" : idx === 1 ? "" : idx === 2 ? "" : "";
      li.textContent = `${medal} ${cat} — ${money(amt)}`;
      rankingOl.appendChild(li);
    });
  }
}

function renderExpensesList() {
  expensesList.innerHTML = "";

  if (expenses.length === 0) {
    const empty = document.createElement("div");
    empty.className = "table-row";
    empty.innerHTML = `<span class="muted">—</span><span class="muted">Sin gastos cargados</span><span class="muted">—</span><span></span>`;
    expensesList.appendChild(empty);
    return;
  }

  for (const g of expenses) {
    const row = document.createElement("div");
    row.className = "table-row";

    const desc = g.description && g.description.trim() ? g.description.trim() : "Sin descripción";

    const original = g.currency === "USD" ? formatUSD(g.amount) : money(g.amount);
    const equiv = money(g.amountARS);

    row.innerHTML = `
      <span>${g.category}</span>
      <span>${desc}</span>
      <span class="amount">
        ${original}
        <span class="muted subamount">≈ ${equiv}</span>
      </span>
      <span><button class="icon-btn" data-id="${g.id}" type="button">Eliminar</button></span>
    `;

    expensesList.appendChild(row);
  }
}

function renderAll() {
  renderKPIs();
  renderStatus();
  renderCategoryTotalsAndRanking();
  renderExpensesList();
}

// ================================
// Validations
// ================================
function validateExpenseInput(category, amount, currency) {
  if (!category) return "Elegí una categoría.";
  if (!Number.isFinite(amount) || amount <= 0) return "Ingresá un monto válido (mayor que 0).";

  if (currency === "USD" && !Number.isFinite(fx.venta)) {
    return "No hay cotización disponible para USD. Recargá o usá ARS.";
  }

  const amountARS = expenseToARS(amount, currency);
  if (!Number.isFinite(amountARS)) return "No se pudo convertir el monto a ARS.";

  if (income > 0 && amountARS > balanceARS()) return "Ese gasto supera el saldo disponible.";
  return null;
}

// ================================
// Events
// ================================
incomeForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const value = Number(incomeInput.value);
  if (!Number.isFinite(value) || value < 0) {
    setMsg(incomeMsg, "Ingresá un número válido (0 o mayor).", "err");
    return;
  }

  income = value;
  saveIncome(income);

  setMsg(incomeMsg, "Ingreso guardado.", "ok");
  toast("Ingreso guardado.");
  renderAll();
});

expenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const category = categorySelect.value;
  const amount = Number(amountInput.value);
  const currency = currencySelect.value;
  const description = descInput.value || "";

  
  if (currency === "USD") {
    await refreshFx(false);
  }

  const error = validateExpenseInput(category, amount, currency);
  if (error) {
    setMsg(expenseMsg, `⚠️ ${error}`, "err");
    toast(error, "err");
    return;
  }

  const amountARS = expenseToARS(amount, currency);

  const newExpense = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    category,
    amount,
    currency,
    amountARS,
    description,
    createdAt: Date.now(),
    fxCasa: currency === "USD" ? fx.casa : null,
    fxVenta: currency === "USD" ? fx.venta : null,
  };

  expenses.push(newExpense);
  saveExpenses(expenses);

  // Reset form (precarga de defaults)
  amountInput.value = "";
  descInput.value = "";
  categorySelect.value = "";
  currencySelect.value = "ARS";
  

  setMsg(expenseMsg, "Gasto agregado.", "ok");
  toast("Gasto agregado.");
  renderAll();
});

// Re-cargar dólar cuando cambia 
dolarCasaSelect.addEventListener("change", () => {
  refreshFx(true);
});

currencySelect.addEventListener("change", async () => {
  updateFxVisibility();

  if (currencySelect.value === "USD") {
    await refreshFx(false);
  }
});


// Eliminar gasto 
expensesList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;

  const id = btn.dataset.id;
  expenses = expenses.filter((g) => g.id !== id);
  saveExpenses(expenses);

  toast("Gasto eliminado.");
  renderAll();
});

// Borrar todo (SweetAlert2)
clearBtn.addEventListener("click", async () => {
  const r = await Swal.fire({
    icon: "warning",
    title: "¿Borrar todo?",
    text: "Se eliminarán todos los gastos cargados.",
    showCancelButton: true,
    confirmButtonText: "Sí, borrar",
    cancelButtonText: "Cancelar",
  });

  if (!r.isConfirmed) return;

  expenses = [];
  saveExpenses(expenses);

  toast("Gastos borrados.");
  renderAll();
});

// ================================
// Init 
// ================================
async function init() {
  incomeInput.value = income ? String(income) : "";
  setMsg(incomeMsg, "", "");
  setMsg(expenseMsg, "", "");

  await loadCategories();
  await refreshFx(false);

  updateFxVisibility();

  renderAll();
}

init();
