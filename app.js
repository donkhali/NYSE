// URL pública publicada de la pestaña PWA_Export (gid=1209965672)
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTlJjr1jKCHJ2CPjYH5WxzF8WRtbe5tLqODValC7vsfHiTWAhNV9KFajakURDudWKbNeHaWhtHPgVP8/pub?gid=1209965672&single=true&output=csv';

let rawData = [];

const statusBar = document.getElementById('status-bar');
const tableBody = document.getElementById('table-body');
const searchInput = document.getElementById('search-input');

async function autoCargarDatosSheets() {
  try {
    if (statusBar) statusBar.textContent = "⏳ Cargando datos en vivo...";

    // URL con timestamp para evitar la caché del navegador
    const urlSinCache = `${CSV_URL}&_ts=${Date.now()}`;
    const response = await fetch(urlSinCache, {
      cache: 'no-store',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}: No se pudo descargar la pestaña PWA_Export.`);
    }

    const csvText = await response.text();

    if (!csvText || csvText.trim() === '') {
      throw new Error("El archivo CSV está vacío.");
    }

    const rows = parsearCSVLineaPorLinea(csvText);

    if (rows.length <= 1) {
      rawData = [];
      actualizarKPIs([]);
      renderTabla([]);
      if (statusBar) statusBar.textContent = "⚠️ Sin activos en PWA_Export. Corre el script de Python.";
      return;
    }

    renderizarTablaPWA(rows);

    if (statusBar) {
      statusBar.textContent = `✅ Sincronizado (${rawData.length} activos) - ${new Date().toLocaleTimeString()}`;
    }

  } catch (err) {
    console.error("Error PWA:", err);
    if (statusBar) statusBar.textContent = `❌ Error: ${err.message}`;
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center" style="color:#FF7043; padding:20px;">
            <b>Fallo en la carga:</b> ${err.message}
          </td>
        </tr>`;
    }
  }
}

// Parser CSV robusto con soporte para comillas y comas entre valores
function parsearCSVLineaPorLinea(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];

  return lines.map(line => {
    let result = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      let c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(cell.trim());
        cell = '';
      } else {
        cell += c;
      }
    }
    result.push(cell.trim());
    return result;
  });
}

function renderizarTablaPWA(rows) {
  const dataRows = rows.slice(1);

  rawData = dataRows.map(row => {
    if (row.length < 8) return null;

    const ticker = row[0].replace(/^"|"$/g, '');
    const sector = row[1].replace(/^"|"$/g, '');

    // Normalizar formato de números (soporta comas o puntos decimales)
    const cleanNum = (v) => parseFloat(v.replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;

    const precio = cleanNum(row[2]).toFixed(2);
    const ema20 = cleanNum(row[3]).toFixed(2);
    const distEMA20 = cleanNum(row[4]);
    const distSMA50 = cleanNum(row[5]);
    const ventasYoY = cleanNum(row[6]).toFixed(1);
    const estado = row[7].replace(/^"|"$/g, '') || '⌛ EN ESPERA';

    let badgeClass = "badge-espera";
    if (estado.includes("IDEAL")) badgeClass = "badge-ideal";
    else if (estado.includes("REBOTE") || estado.includes("MOMENTUM")) badgeClass = "badge-rebote";
    else if (estado.includes("SOBREEXTENDIDO")) badgeClass = "badge-sobre";
    else if (estado.includes("SOPORTE")) badgeClass = "badge-soporte";

    return {
      ticker,
      sector,
      precio,
      ema20,
      distEMA20,
      distSMA50,
      ventasYoY,
      estado,
      badgeClass
    };
  }).filter(item => item !== null);

  actualizarKPIs(rawData);
  renderTabla(rawData);
}

function actualizarKPIs(data) {
  const elTotal = document.getElementById('kpi-total');
  const elIdeal = document.getElementById('kpi-ideal');
  const elMomentum = document.getElementById('kpi-momentum');
  const elSobre = document.getElementById('kpi-sobre');

  if (elTotal) elTotal.textContent = data.length;
  if (elIdeal) elIdeal.textContent = data.filter(d => d.estado.includes("IDEAL")).length;
  if (elMomentum) elMomentum.textContent = data.filter(d => d.estado.includes("REBOTE") || d.estado.includes("MOMENTUM")).length;
  if (elSobre) elSobre.textContent = data.filter(d => d.estado.includes("SOBREEXTENDIDO")).length;
}

function renderTabla(data) {
  if (!tableBody) return;
  tableBody.innerHTML = "";

  if (data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center">No hay activos registrados.</td></tr>`;
    return;
  }

  data.forEach(item => {
    const tr = document.createElement('tr');

    const distEMAStr = (item.distEMA20 > 0 ? '+' : '') + item.distEMA20.toFixed(2) + '%';
    const distSMAStr = (item.distSMA50 > 0 ? '+' : '') + item.distSMA50.toFixed(2) + '%';

    tr.innerHTML = `
      <td><b>${item.ticker}</b></td>
      <td>${item.sector}</td>
      <td>$${item.precio}</td>
      <td>$${item.ema20}</td>
      <td style="color:${item.distEMA20 >= 0 ? '#2ECC71' : '#FF7043'}">${distEMAStr}</td>
      <td style="color:${item.distSMA50 >= 0 ? '#2ECC71' : '#FF7043'}">${distSMAStr}</td>
      <td>${item.ventasYoY}%</td>
      <td><span class="badge ${item.badgeClass}">${item.estado}</span></td>
    `;
    tableBody.appendChild(tr);
  });
}

// Filtro de búsqueda en vivo
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = rawData.filter(d => 
      d.ticker.toLowerCase().includes(query) || 
      d.sector.toLowerCase().includes(query)
    );
    renderTabla(filtered);
  });
}

// Escuchadores de eventos para sincronización automática
document.addEventListener('DOMContentLoaded', autoCargarDatosSheets);
window.addEventListener('focus', autoCargarDatosSheets);