let dbInstance = null;
let rawData = [];

const btnSync = document.getElementById('btn-sync');
const statusBar = document.getElementById('status-bar');
const tableBody = document.getElementById('table-body');
const searchInput = document.getElementById('search-input');

// Cargar motor SQL.js
async function initSQLite() {
  const SQL = await initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  });
  return SQL;
}

// Cargar la BD desde la raíz de GitHub Pages
async function cargarBD() {
  try {
    statusBar.textContent = "⏳ Descargando base de datos SQLite...";
    btnSync.disabled = true;

    const response = await fetch('acciones_crecimiento.db');
    if (!response.ok) throw new Error("No se encontró el archivo 'acciones_crecimiento.db'");
    
    const buffer = await response.arrayBuffer();
    const SQL = await initSQLite();
    dbInstance = new SQL.Database(new Uint8Array(buffer));

    statusBar.textContent = "✅ Base de datos cargada correctamente.";
    btnSync.disabled = false;
    
    procesarEscaneo();
  } catch (err) {
    statusBar.textContent = `❌ Error: ${err.message}`;
    btnSync.disabled = false;
  }
}

// Procesar y calificar activos
function procesarEscaneo() {
  if (!dbInstance) return;

  const query = `
    SELECT Ticker, Sector, LastClose, EMA20, SMA50, RevenueGrowth_YoY 
    FROM universo_filtrado
  `;
  
  const res = dbInstance.exec(query);
  if (res.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center">No se encontraron registros.</td></tr>`;
    return;
  }

  const columns = res[0].columns;
  const values = res[0].values;

  rawData = values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    
    const close = obj.LastClose;
    const ema20 = obj.EMA20;
    const sma50 = obj.SMA50;

    const distEMA20 = ((close - ema20) / ema20) * 100;
    const distSMA50 = ((close - sma50) / sma50) * 100;

    let estado = "⌛ EN ESPERA";
    let badgeClass = "badge-espera";

    if (distEMA20 >= -1.5 && distEMA20 <= 0.5 && distSMA50 > 0) {
      estado = "🎯 ENTRADA IDEAL";
      badgeClass = "badge-ideal";
    } else if (distEMA20 > 0.5 && distEMA20 <= 2.0 && distSMA50 > 0) {
      estado = "🚀 REBOTE / MOMENTUM";
      badgeClass = "badge-rebote";
    } else if (distEMA20 > 5.0) {
      estado = "⚠️ SOBREEXTENDIDO";
      badgeClass = "badge-sobre";
    } else if (distEMA20 < -2.0) {
      estado = "🔍 SOPORTE SMA50";
      badgeClass = "badge-soporte";
    }

    return {
      ticker: obj.Ticker,
      sector: obj.Sector || 'N/A',
      close: close.toFixed(2),
      ema20: ema20.toFixed(2),
      distEMA20: distEMA20.toFixed(2),
      distSMA50: distSMA50.toFixed(2),
      ventasYoY: ((obj.RevenueGrowth_YoY || 0) * 100).toFixed(1),
      estado: estado,
      badgeClass: badgeClass,
      absDist: Math.abs(distEMA20)
    };
  });

  // Ordenar por cercanía absoluta a la EMA20
  rawData.sort((a, b) => a.absDist - b.absDist);

  actualizarKPIs(rawData);
  renderTabla(rawData);
}

function actualizarKPIs(data) {
  document.getElementById('kpi-total').textContent = data.length;
  document.getElementById('kpi-ideal').textContent = data.filter(d => d.estado.includes("IDEAL")).length;
  document.getElementById('kpi-momentum').textContent = data.filter(d => d.estado.includes("REBOTE")).length;
  document.getElementById('kpi-sobre').textContent = data.filter(d => d.estado.includes("SOBREEXTENDIDO")).length;
}

function renderTabla(data) {
  tableBody.innerHTML = "";
  
  data.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${item.ticker}</b></td>
      <td>${item.sector}</td>
      <td>$${item.close}</td>
      <td>$${item.ema20}</td>
      <td style="color:${item.distEMA20 >= 0 ? '#2ECC71' : '#FF7043'}">${item.distEMA20 > 0 ? '+' : ''}${item.distEMA20}%</td>
      <td style="color:${item.distSMA50 >= 0 ? '#2ECC71' : '#FF7043'}">${item.distSMA50 > 0 ? '+' : ''}${item.distSMA50}%</td>
      <td>${item.ventasYoY}%</td>
      <td><span class="badge ${item.badgeClass}">${item.estado}</span></td>
    `;
    tableBody.appendChild(tr);
  });
}

// Búsqueda interactiva
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = rawData.filter(d => 
    d.ticker.toLowerCase().includes(query) || 
    d.sector.toLowerCase().includes(query)
  );
  renderTabla(filtered);
});

btnSync.addEventListener('click', cargarBD);