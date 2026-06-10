// ============================================
// ADMIN.JS - Dashboard AL BARRIL v2
// ============================================

const PRODUCT_IMAGE_MAP = {
  'Picada Personal': 'assets/picada-surtida.jpg',
  'Picada para 2': 'assets/picada-surtida.jpg',
  'Picada para 4': 'assets/picada-surtida.jpg',
  'Chicharronada': 'assets/chicharron-2.jpg',
  'Bondiola': 'assets/bondiola.jpg',
  'Costillitas': 'assets/costillas-1.jpg',
  'Ceviche de Chicharrón': 'assets/chicharron-cortado.jpg'
};

function resolveImage(product) {
  if (product.imagen_url && product.imagen_url.trim()) return product.imagen_url;
  return PRODUCT_IMAGE_MAP[product.nombre] || 'assets/picada-surtida.jpg';
}

// ============================================
// PROTECCIÓN: solo logueados
// ============================================
if (!Auth.isLoggedIn()) {
  window.location.href = 'index.html';
}

// ============================================
// HORARIO DE SERVICIO (configurable)
// ============================================
const SERVICE_START = '13:30'; // 1:30 PM
const SERVICE_END   = '15:00'; // 3:00 PM
const SLOT_INTERVAL_MIN = 30;

// ============================================
// LÓGICA DE "FIN DE SEMANA ACTIVO"
// Viernes / Sábado antes de 12:00 → muestra pedidos del próximo sábado
// Sábado 12:00 en adelante         → muestra pedidos del próximo domingo
// Domingo 12:00 en adelante        → vacío (hasta que haya pedidos para próximo sábado)
// ============================================

/**
 * Retorna el "fin de semana activo" = { sabado: Date|null, domingo: Date|null }
 * sabado  → la fecha del sábado cuyos pedidos deben mostrarse en el dashboard principal
 * domingo → la fecha del domingo cuyos pedidos deben mostrarse en el dashboard principal
 * Solo uno de los dos estará activo según la hora, el otro será null.
 */
function getActiveWeekend() {
  const now = new Date();
  const dow = now.getDay(); // 0=dom, 6=sab
  const hour = now.getHours() + now.getMinutes() / 60;
  const CUTOFF = 12; // 12:00 PM

  // Encontrar el próximo sábado y domingo
  function nextWeekday(targetDow) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    let diff = targetDow - d.getDay();
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  // Función para obtener el sábado de "esta semana" o el próximo
  function thisSatOrNext() {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const diff = 6 - d.getDay(); // cuántos días hasta sábado (puede ser 0 si hoy es sab)
    d.setDate(d.getDate() + diff);
    return d;
  }
  function thisSunOrNext() {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const diff = 7 - d.getDay(); // cuántos días hasta domingo (puede ser 7 si hoy ya es dom, pero queremos el mismo día)
    // domingo = 0
    if (d.getDay() === 0) {
      // hoy es domingo
      return d;
    }
    d.setDate(d.getDate() + (7 - d.getDay()));
    return d;
  }

  if (dow === 6) {
    // HOY ES SÁBADO
    if (hour < CUTOFF) {
      // antes de las 12 → mostrar pedidos de HOY (sábado)
      const sab = new Date(now); sab.setHours(0,0,0,0);
      return { sabado: sab, domingo: null };
    } else {
      // 12 PM en adelante → mostrar pedidos del DOMINGO que viene
      const dom = new Date(now); dom.setHours(0,0,0,0); dom.setDate(dom.getDate() + 1);
      return { sabado: null, domingo: dom };
    }
  } else if (dow === 0) {
    // HOY ES DOMINGO
    if (hour < CUTOFF) {
      // antes de las 12 → mostrar pedidos de HOY (domingo)
      const dom = new Date(now); dom.setHours(0,0,0,0);
      return { sabado: null, domingo: dom };
    } else {
      // 12 PM en adelante → vacío hasta próximo sábado
      return { sabado: null, domingo: null };
    }
  } else if (dow === 5) {
    // VIERNES → mostrar pedidos del sábado próximo
    const sab = nextWeekday(6);
    return { sabado: sab, domingo: null };
  } else {
    // Lunes a jueves: mostrar pedidos del próximo sábado
    const sab = nextWeekday(6);
    return { sabado: sab, domingo: null };
  }
}

function isoDate(d) {
  if (!d) return null;
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ============================================
// ESTADO
// ============================================
let ALL_ORDERS = [];
let CURRENT_FILTER = 'all';
let CONFIG = {};
let WA_NUMBER = '573185348389';
// Pedidos filtrados para el dashboard principal (solo fin de semana activo)
let DASHBOARD_ORDERS = [];

// ============================================
// NAVIGATION
// ============================================
function wireNav() {
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.admin-view').forEach(v => {
        v.hidden = true;
        v.classList.remove('active');
      });
      const target = document.getElementById(`view-${view}`);
      target.hidden = false;
      target.classList.add('active');
      document.getElementById('sidebar').classList.remove('open');

      if (view === 'menu') loadProductsAdmin();
      if (view === 'config') loadConfigForm();
      if (view === 'compras') loadCompras();
      if (view === 'historial') renderHistorial();
    });
  });

  document.getElementById('mobile-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    Auth.logout();
    window.location.href = 'index.html';
  });
}

// ============================================
// PEDIDOS
// ============================================
async function loadOrders() {
  try {
    const { data, error } = await db
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    ALL_ORDERS = data || [];

    // Calcular qué fin de semana mostrar en el dashboard
    const aw = getActiveWeekend();
    const activeDateISO = aw.sabado ? isoDate(aw.sabado) : (aw.domingo ? isoDate(aw.domingo) : null);

    if (activeDateISO) {
      DASHBOARD_ORDERS = ALL_ORDERS.filter(o => o.fecha_entrega === activeDateISO);
    } else {
      DASHBOARD_ORDERS = [];
    }

    renderOrders();
    updateStats(aw, activeDateISO);
  } catch (err) {
    console.error('Error cargando pedidos:', err);
    document.getElementById('orders-list').innerHTML = `<div class="loading-state">Error al cargar pedidos. ${err.message || ''}</div>`;
  }
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  let orders = DASHBOARD_ORDERS;

  if (CURRENT_FILTER !== 'all') {
    orders = orders.filter(o => o.estado === CURRENT_FILTER);
  }

  if (orders.length === 0) {
    const aw = getActiveWeekend();
    let emptyMsg = 'No hay pedidos activos para este fin de semana.';
    if (!aw.sabado && !aw.domingo) {
      emptyMsg = 'El servicio de este fin de semana ha cerrado. Revisa el historial para ver los pedidos pasados.';
    }
    list.innerHTML = `<div class="loading-state">${emptyMsg}</div>`;
    return;
  }

  list.innerHTML = orders.map(o => renderOrderCard(o)).join('');
  list.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => openOrderModal(Number(card.dataset.id)));
  });
}

function renderOrderCard(o) {
  const fecha = new Date(o.fecha_entrega + 'T00:00:00');
  const fechaStr = formatDateLong(fecha).replace(/^(\w)/, m => m.toUpperCase());
  const created = new Date(o.created_at);
  const createdStr = `${created.getDate()}/${created.getMonth()+1}/${created.getFullYear()} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}`;
  const cant = (o.items || []).reduce((s, i) => s + i.cantidad, 0);

  return `
    <div class="order-card" data-id="${o.id}" data-estado="${o.estado}">
      <div class="order-main-info">
        <div class="order-top-row">
          <span class="order-id">#${String(o.id).padStart(4, '0')}</span>
          <span class="estado-badge estado-${o.estado}">${o.estado}</span>
        </div>
        <div class="order-client">${o.nombre_cliente}</div>
        <div class="order-meta">
          <span class="order-meta-item">📞 ${o.telefono}</span>
          <span class="order-meta-item">📅 ${fechaStr} · ${formatTime12h(o.hora_entrega)}</span>
          <span class="order-meta-item">${o.modalidad === 'domicilio' ? '🛵 Domicilio' : '🏠 Recoger'}</span>
          <span class="order-meta-item">${cant} ${cant === 1 ? 'producto' : 'productos'}</span>
        </div>
      </div>
      <div class="order-right">
        <div class="order-total">${formatPrice(o.total)}</div>
        <div class="order-created">${createdStr}</div>
      </div>
    </div>
  `;
}

function updateStats(aw, activeDateISO) {
  const pendientes = DASHBOARD_ORDERS.filter(o => o.estado === 'pendiente').length;
  const confirmados = DASHBOARD_ORDERS.filter(o => o.estado === 'confirmado').length;

  const totalActivo = DASHBOARD_ORDERS
    .filter(o => o.estado !== 'cancelado')
    .reduce((s, o) => s + o.total, 0);

  // Etiqueta del stat: "Sábado" o "Domingo"
  let statLabel = 'Activo';
  if (aw && aw.sabado) statLabel = 'Sábado';
  else if (aw && aw.domingo) statLabel = 'Domingo';

  document.getElementById('stat-pendientes').textContent = pendientes;
  document.getElementById('stat-confirmados').textContent = confirmados;
  document.getElementById('stat-hoy').textContent = formatPrice(totalActivo);

  const statHoyLabel = document.getElementById('stat-hoy-label');
  if (statHoyLabel) statHoyLabel.textContent = statLabel;

  const badge = document.getElementById('nav-pendientes-badge');
  if (pendientes > 0) {
    badge.textContent = pendientes;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  const comprasBadge = document.getElementById('nav-compras-badge');
  if (comprasBadge) {
    const totalConfirmados = ALL_ORDERS.filter(o => o.estado === 'confirmado').length;
    if (totalConfirmados > 0) {
      comprasBadge.textContent = totalConfirmados;
      comprasBadge.hidden = false;
    } else {
      comprasBadge.hidden = true;
    }
  }

  // Mostrar banner de qué día está activo
  const bannerEl = document.getElementById('active-weekend-banner');
  if (bannerEl) {
    if (activeDateISO && (aw.sabado || aw.domingo)) {
      const d = new Date(activeDateISO + 'T00:00:00');
      const label = aw.sabado ? 'SÁBADO' : 'DOMINGO';
      bannerEl.innerHTML = `
        <span class="banner-dot"></span>
        Mostrando pedidos del <strong>${label} ${d.getDate()} de ${['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][d.getMonth()]}</strong>
        · <span style="color:var(--cream-soft); font-size:0.82rem;">Total facturado (no cancelados): <strong style="color:var(--gold);">${formatPrice(totalActivo)}</strong></span>
      `;
      bannerEl.hidden = false;
    } else {
      bannerEl.innerHTML = `<span class="banner-dot banner-dot-off"></span> Sin pedidos activos hasta el próximo viernes`;
      bannerEl.hidden = false;
    }
  }
}

function wireFilters() {
  document.querySelectorAll('.filter-pill').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      CURRENT_FILTER = b.dataset.filter;
      renderOrders();
    });
  });
}

// ============================================
// FILTROS DE HORA (dashboard principal)
// ============================================
function wireTimeFilter() {
  const sel = document.getElementById('filter-hora');
  if (!sel) return;
  sel.addEventListener('change', () => {
    renderOrders();
  });
}

// Override renderOrders para respetar filtro de hora también
const _origRenderOrders = renderOrders;
function renderOrders() {
  const list = document.getElementById('orders-list');
  let orders = DASHBOARD_ORDERS;

  if (CURRENT_FILTER !== 'all') {
    orders = orders.filter(o => o.estado === CURRENT_FILTER);
  }

  const horaFiltro = document.getElementById('filter-hora')?.value || '';
  if (horaFiltro) {
    orders = orders.filter(o => o.hora_entrega === horaFiltro);
  }

  if (orders.length === 0) {
    const aw = getActiveWeekend();
    let emptyMsg = 'No hay pedidos activos para este fin de semana.';
    if (!aw.sabado && !aw.domingo) {
      emptyMsg = 'El servicio de este fin de semana ha cerrado. Revisa el historial.';
    } else if (horaFiltro) {
      emptyMsg = `No hay pedidos para las ${formatTime12h(horaFiltro)}.`;
    }
    list.innerHTML = `<div class="loading-state">${emptyMsg}</div>`;
    return;
  }

  // Total filtrado
  const totalFiltrado = orders.filter(o => o.estado !== 'cancelado').reduce((s,o) => s + o.total, 0);
  const totalEl = document.getElementById('filtered-total');
  if (totalEl) {
    totalEl.textContent = `Total filtrado: ${formatPrice(totalFiltrado)} (${orders.filter(o=>o.estado!=='cancelado').length} pedidos)`;
    totalEl.hidden = false;
  }

  list.innerHTML = orders.map(o => renderOrderCard(o)).join('');
  list.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => openOrderModal(Number(card.dataset.id)));
  });

  // Boton exportar excel del dashboard
  const exportBtn = document.getElementById('export-excel-btn');
  if (exportBtn) {
    exportBtn.dataset.orders = JSON.stringify(orders.map(o => o.id));
  }
}

// ============================================
// HISTORIAL
// ============================================
function renderHistorial() {
  const container = document.getElementById('historial-content');
  if (!container) return;

  const fDesde = document.getElementById('hist-desde')?.value || '';
  const fHasta = document.getElementById('hist-hasta')?.value || '';
  const fDia = document.getElementById('hist-dia')?.value || 'all'; // 'all'|'sabado'|'domingo'
  const fHora = document.getElementById('hist-hora')?.value || '';
  const fEstado = document.getElementById('hist-estado')?.value || 'all';

  let orders = [...ALL_ORDERS];

  // Filtrar por día de semana
  if (fDia === 'sabado') {
    orders = orders.filter(o => {
      const d = new Date(o.fecha_entrega + 'T00:00:00');
      return d.getDay() === 6;
    });
  } else if (fDia === 'domingo') {
    orders = orders.filter(o => {
      const d = new Date(o.fecha_entrega + 'T00:00:00');
      return d.getDay() === 0;
    });
  }

  // Filtrar por rango de fechas
  if (fDesde) orders = orders.filter(o => o.fecha_entrega >= fDesde);
  if (fHasta) orders = orders.filter(o => o.fecha_entrega <= fHasta);

  // Filtrar por hora
  if (fHora) orders = orders.filter(o => o.hora_entrega === fHora);

  // Filtrar por estado
  if (fEstado !== 'all') orders = orders.filter(o => o.estado === fEstado);

  // Agrupar por fecha_entrega
  const grupos = {};
  orders.forEach(o => {
    if (!grupos[o.fecha_entrega]) grupos[o.fecha_entrega] = [];
    grupos[o.fecha_entrega].push(o);
  });

  const fechas = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

  if (fechas.length === 0) {
    container.innerHTML = '<div class="loading-state">No hay pedidos con esos filtros.</div>';
    return;
  }

  let html = '';
  let grandTotal = 0;

  fechas.forEach(fecha => {
    const grupo = grupos[fecha];
    const d = new Date(fecha + 'T00:00:00');
    const diaNombre = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][d.getDay()];
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const fechaLabel = `${diaNombre.charAt(0).toUpperCase()+diaNombre.slice(1)} ${d.getDate()} de ${meses[d.getMonth()]} ${d.getFullYear()}`;
    const totalFecha = grupo.filter(o => o.estado !== 'cancelado').reduce((s,o) => s + o.total, 0);
    grandTotal += totalFecha;

    html += `
      <div class="historial-grupo">
        <div class="historial-grupo-header">
          <div class="historial-fecha-label">${fechaLabel}</div>
          <div class="historial-fecha-total">${formatPrice(totalFecha)} · ${grupo.filter(o=>o.estado!=='cancelado').length} pedidos</div>
          <button class="btn btn-ghost btn-sm" onclick="exportExcelForDate('${fecha}', '${fechaLabel}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar Excel
          </button>
        </div>
        <div class="historial-orders">
          ${grupo.map(o => renderOrderCard(o)).join('')}
        </div>
      </div>
    `;
  });

  // Grand total
  html += `
    <div class="historial-grand-total">
      <span>TOTAL FILTRADO</span>
      <span>${formatPrice(grandTotal)}</span>
    </div>
  `;

  container.innerHTML = html;

  // Wire clicks en cards
  container.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => openOrderModal(Number(card.dataset.id)));
  });
}

function wireHistorialFilters() {
  ['hist-desde','hist-hasta','hist-dia','hist-hora','hist-estado'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderHistorial);
  });
}

// ============================================
// EXPORT EXCEL
// ============================================
function exportExcelForDate(fechaISO, fechaLabel) {
  const orders = ALL_ORDERS.filter(o => o.fecha_entrega === fechaISO && o.estado !== 'cancelado');
  if (orders.length === 0) { showToast('No hay pedidos para exportar', 'error'); return; }

  // Construir CSV (compatible con Excel)
  const headers = ['#Pedido','Nombre','Teléfono','Modalidad','Dirección/Local','Hora','Productos','Total','Estado','Fecha pedido'];
  const rows = orders.map(o => {
    const created = new Date(o.created_at);
    const createdStr = `${created.getDate()}/${created.getMonth()+1}/${created.getFullYear()} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}`;
    const productos = (o.items||[]).map(i => `${i.cantidad}x ${i.nombre}${i.guacamole_extra?' (+guacamole)':''}`).join(' | ');
    const ubicacion = o.modalidad === 'domicilio' ? (o.direccion || '') : 'Recoger en local';
    return [
      '#' + String(o.id).padStart(4,'0'),
      o.nombre_cliente,
      o.telefono,
      o.modalidad === 'domicilio' ? 'Domicilio' : 'Recoger',
      ubicacion,
      formatTime12h(o.hora_entrega),
      productos,
      o.total,
      o.estado,
      createdStr
    ];
  });

  const total = orders.reduce((s,o) => s + o.total, 0);
  rows.push([]);
  rows.push(['','','','','','','TOTAL FACTURADO', total, '', '']);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => {
      const s = String(cell ?? '').replace(/"/g, '""');
      return `"${s}"`;
    }).join(','))
    .join('\n');

  const BOM = '\uFEFF'; // BOM para que Excel abra bien UTF-8
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AlBarril_${fechaLabel.replace(/\s+/g,'_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Excel exportado ✓');
}

// ============================================
// ORDER MODAL
// ============================================
function openOrderModal(id) {
  const o = ALL_ORDERS.find(x => x.id === id);
  if (!o) return;

  const fecha = new Date(o.fecha_entrega + 'T00:00:00');
  const created = new Date(o.created_at);
  const createdStr = `${created.getDate()}/${created.getMonth()+1}/${created.getFullYear()} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}`;

  const domicilioLinea = o.modalidad === 'domicilio'
    ? `Dirección: ${o.direccion}\n`
    : `Recoges en: Mediterráne Toscana\n`;

  const waMsg = encodeURIComponent(
    `Hola ${o.nombre_cliente}, te escribo de AL BARRIL 🔥\n\n` +
    `Recibimos tu pedido #${String(o.id).padStart(4,'0')}:\n` +
    (o.items || []).map(i => `· ${i.cantidad}× ${i.nombre}${i.guacamole_extra ? ' (+ guacamole extra)' : ''}`).join('\n') +
    `\n\n` +
    `Total: ${formatPrice(o.total)}\n` +
    `Entrega: ${formatDateLong(fecha)} · ${formatTime12h(o.hora_entrega)}\n` +
    domicilioLinea +
    `\nPara confirmar tu pedido, por favor realiza la transferencia a la siguiente cuenta:\n\n` +
    `Ahorros Bancolombia:\n` +
    `090-583593-59\n\n` +
    `Llave: 1095908644\n\n` +
    `¡Gracias! 😊😊`
  );

  const body = document.getElementById('order-modal-body');
  body.innerHTML = `
    <h3 class="modal-title" style="font-size: 1.6rem; margin-bottom: 4px;">PEDIDO #${String(o.id).padStart(4,'0')}</h3>
    <p style="text-align: center; margin-bottom: 26px;">
      <span class="estado-badge estado-${o.estado}">${o.estado}</span>
    </p>

    <div class="order-detail-section">
      <div class="order-detail-title">Cliente</div>
      <div class="order-detail-row"><span>Nombre</span><strong>${o.nombre_cliente}</strong></div>
      <div class="order-detail-row"><span>WhatsApp</span><strong>${o.telefono}</strong></div>
      <div class="order-detail-row"><span>Modalidad</span><strong>${o.modalidad === 'domicilio' ? 'Domicilio' : 'Recoger en local'}</strong></div>
      ${o.modalidad === 'domicilio' ? `<div class="order-detail-row"><span>Dirección</span><strong>${o.direccion}</strong></div>` : ''}
    </div>

    <div class="order-detail-section">
      <div class="order-detail-title">Entrega</div>
      <div class="order-detail-row"><span>Fecha</span><strong>${formatDateLong(fecha).replace(/^(\w)/, m => m.toUpperCase())}</strong></div>
      <div class="order-detail-row"><span>Hora</span><strong>${formatTime12h(o.hora_entrega)}</strong></div>
      ${o.observaciones ? `<div class="order-detail-row"><span>Observaciones</span><strong style="text-align: right; max-width: 60%;">${o.observaciones}</strong></div>` : ''}
    </div>

    <div class="order-detail-section">
      <div class="order-detail-title">Productos</div>
      <table class="order-items-table">
        <tbody>
          ${(o.items || []).map(i => `
            <tr>
              <td>${i.cantidad}× ${i.nombre}${i.guacamole_extra ? '<br><span style="font-size:0.78rem; color:var(--gold); font-style:italic;">+ guacamole extra</span>' : ''}</td>
              <td>${formatPrice(i.subtotal)}</td>
            </tr>
          `).join('')}
          <tr>
            <td class="order-total-row"><strong>TOTAL</strong></td>
            <td class="order-total-row">${formatPrice(o.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="order-detail-section">
      <div class="order-detail-title">Fecha de solicitud</div>
      <div class="order-detail-row"><span>Creado</span><strong>${createdStr}</strong></div>
    </div>

    ${o.estado === 'pendiente' ? `
      <div style="background: rgba(201, 81, 30, 0.1); border-left: 3px solid var(--ember); padding: 12px 14px; margin-bottom: 16px; font-size: 0.88rem; color: var(--cream-soft);">
        <strong style="color: var(--ember-bright);">Contacta al cliente</strong> por WhatsApp para confirmar el pedido y compartirle la cuenta bancaria para el pago.
      </div>
    ` : ''}

    <div class="order-actions-grid">
      <a href="https://wa.me/${o.telefono.replace(/\D/g,'')}?text=${waMsg}" target="_blank" class="btn btn-primary btn-wa">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
        Contactar por WhatsApp
      </a>
      ${o.estado === 'pendiente' ? `<button class="btn-state primary" data-state="confirmado" data-id="${o.id}">Confirmar pedido</button>` : ''}
      ${o.estado === 'confirmado' ? `<button class="btn-state primary" data-state="entregado" data-id="${o.id}">Marcar entregado</button>` : ''}
      ${(o.estado === 'pendiente' || o.estado === 'confirmado') ? `<button class="btn-state danger" data-action="cancel" data-id="${o.id}">Cancelar pedido</button>` : ''}
      ${o.estado === 'entregado' ? `<button class="btn-state" data-state="pendiente" data-id="${o.id}">Volver a pendiente</button>` : ''}
      ${o.estado === 'cancelado' ? `<button class="btn-state" data-state="pendiente" data-id="${o.id}">Reactivar pedido</button>` : ''}
      ${o.estado === 'cancelado' ? `<button class="btn-state danger" data-action="delete" data-id="${o.id}">Eliminar definitivamente</button>` : ''}
    </div>
  `;

  body.querySelectorAll('.btn-state[data-state]').forEach(btn => {
    btn.addEventListener('click', () => updateOrderState(Number(btn.dataset.id), btn.dataset.state));
  });
  body.querySelectorAll('.btn-state[data-action="cancel"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const pedido = ALL_ORDERS.find(x => x.id === id);
      const msg = pedido && pedido.estado === 'confirmado'
        ? `⚠️ Este pedido ya está CONFIRMADO (posiblemente el cliente ya pagó).\n\n¿Seguro que quieres cancelarlo?`
        : `¿Seguro que quieres cancelar este pedido?`;
      if (confirm(msg)) updateOrderState(id, 'cancelado');
    });
  });
  body.querySelectorAll('.btn-state[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      if (confirm(`¿Eliminar definitivamente el pedido #${String(id).padStart(4,'0')}?\n\nEsta acción NO se puede deshacer.`)) {
        deleteOrder(id);
      }
    });
  });

  document.getElementById('order-modal').classList.add('open');
}

async function updateOrderState(id, estado) {
  try {
    const { error } = await db.from('pedidos').update({ estado, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    showToast('Estado actualizado');
    document.getElementById('order-modal').classList.remove('open');
    await loadOrders();
    // Refrescar historial si está visible
    const histView = document.getElementById('view-historial');
    if (histView && !histView.hidden) renderHistorial();
  } catch (err) {
    console.error(err);
    showToast('Error al actualizar', 'error');
  }
}

async function deleteOrder(id) {
  try {
    const { data, error } = await db.from('pedidos').delete().eq('id', id).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      showToast('No se pudo eliminar. Revisa permisos en Supabase.', 'error');
      return;
    }
    showToast('Pedido eliminado');
    document.getElementById('order-modal').classList.remove('open');
    await loadOrders();
    const histView = document.getElementById('view-historial');
    if (histView && !histView.hidden) renderHistorial();
  } catch (err) {
    console.error(err);
    showToast('Error al eliminar: ' + err.message, 'error');
  }
}

// ============================================
// REALTIME
// ============================================
function subscribeRealtime() {
  db.channel('pedidos-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (payload) => {
      loadOrders().then(() => {
        const comprasView = document.getElementById('view-compras');
        if (comprasView && !comprasView.hidden) loadCompras();
        const histView = document.getElementById('view-historial');
        if (histView && !histView.hidden) renderHistorial();
      });
      if (payload.eventType === 'INSERT') {
        showToast(`🔔 Nuevo pedido de ${payload.new.nombre_cliente}!`);
        try { playNotificationSound(); } catch (e) {}
      }
    })
    .subscribe();
}

function playNotificationSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

// ============================================
// MENÚ (CRUD)
// ============================================
async function loadProductsAdmin() {
  const list = document.getElementById('products-admin-list');
  try {
    const { data, error } = await db.from('productos').select('*').order('orden', { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) {
      list.innerHTML = '<div class="loading-state">No hay productos. Agrega el primero.</div>';
      return;
    }
    list.innerHTML = data.map(p => `
      <div class="product-admin-card ${p.activo ? '' : 'inactive'}" data-id="${p.id}">
        <div class="product-image-wrap">
          <img class="product-image" src="${resolveImage(p)}" alt="${p.nombre}" loading="lazy" />
        </div>
        <div class="product-admin-body">
          <div class="product-admin-title">${p.nombre}</div>
          <div class="product-admin-price">${formatPrice(p.precio)}</div>
          <div class="product-admin-status ${p.activo ? 'active' : 'inactive'}">
            ${p.activo ? '● Activo' : '● Oculto'}
          </div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.product-admin-card').forEach(c => {
      c.addEventListener('click', () => openProductModal(Number(c.dataset.id)));
    });
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="loading-state">Error: ${err.message}</div>`;
  }
}

async function openProductModal(id) {
  const modal = document.getElementById('product-modal');
  const title = document.getElementById('product-modal-title');
  const deleteBtn = document.getElementById('delete-product-btn');
  const recetaSection = document.getElementById('receta-section');

  if (id) {
    const { data } = await db.from('productos').select('*').eq('id', id).single();
    title.textContent = 'EDITAR PRODUCTO';
    document.getElementById('p-id').value = data.id;
    document.getElementById('p-nombre').value = data.nombre;
    document.getElementById('p-desc').value = data.descripcion;
    document.getElementById('p-precio').value = data.precio;
    document.getElementById('p-orden').value = data.orden || 0;
    document.getElementById('p-imagen').value = data.imagen_url || '';
    document.getElementById('p-activo').value = data.activo ? 'true' : 'false';
    deleteBtn.hidden = false;
    recetaSection.hidden = false;
    await loadReceta(data.id);
  } else {
    title.textContent = 'NUEVO PRODUCTO';
    document.getElementById('product-form').reset();
    document.getElementById('p-id').value = '';
    document.getElementById('p-orden').value = 99;
    document.getElementById('p-activo').value = 'true';
    deleteBtn.hidden = true;
    recetaSection.hidden = true;
    CURRENT_RECETA = [];
  }

  modal.classList.add('open');
}

async function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('p-id').value;
  const payload = {
    nombre: document.getElementById('p-nombre').value.trim(),
    descripcion: document.getElementById('p-desc').value.trim(),
    precio: Number(document.getElementById('p-precio').value),
    orden: Number(document.getElementById('p-orden').value) || 0,
    imagen_url: document.getElementById('p-imagen').value.trim() || null,
    activo: document.getElementById('p-activo').value === 'true',
    updated_at: new Date().toISOString()
  };

  try {
    let savedId = id;
    let error;
    if (id) {
      ({ error } = await db.from('productos').update(payload).eq('id', id));
    } else {
      const res = await db.from('productos').insert(payload).select().single();
      error = res.error;
      if (res.data) savedId = res.data.id;
    }
    if (error) throw error;
    if (savedId) await saveReceta(savedId);
    showToast(id ? 'Producto y receta actualizados' : 'Producto creado');
    document.getElementById('product-modal').classList.remove('open');
    loadProductsAdmin();
  } catch (err) {
    console.error(err);
    showToast('Error al guardar: ' + err.message, 'error');
  }
}

async function deleteProduct() {
  const id = document.getElementById('p-id').value;
  if (!id) return;
  if (!confirm('¿Seguro que quieres eliminar este producto? Esta acción no se puede deshacer.')) return;
  try {
    const { error } = await db.from('productos').delete().eq('id', id);
    if (error) throw error;
    showToast('Producto eliminado');
    document.getElementById('product-modal').classList.remove('open');
    loadProductsAdmin();
  } catch (err) {
    console.error(err);
    showToast('Error al eliminar: ' + err.message, 'error');
  }
}

function wireProductModal() {
  document.getElementById('add-product-btn').addEventListener('click', () => openProductModal(null));
  document.getElementById('product-modal-close').addEventListener('click', () => {
    document.getElementById('product-modal').classList.remove('open');
  });
  document.getElementById('product-modal').addEventListener('click', (e) => {
    if (e.target.id === 'product-modal') document.getElementById('product-modal').classList.remove('open');
  });
  document.getElementById('product-form').addEventListener('submit', saveProduct);
  document.getElementById('delete-product-btn').addEventListener('click', deleteProduct);
}

// ============================================
// CONFIG
// ============================================
async function loadConfigForm() {
  const { data } = await db.from('configuracion').select('*');
  if (!data) return;
  const map = {};
  data.forEach(c => map[c.clave] = c.valor);
  document.getElementById('cfg-whatsapp').value = map.whatsapp || '';
  document.getElementById('cfg-instagram').value = map.instagram || '';
  document.getElementById('cfg-correo').value = map.correo || '';
  document.getElementById('cfg-direccion').value = map.direccion_local || '';
}

async function saveConfig(e) {
  e.preventDefault();
  const updates = [
    { clave: 'whatsapp', valor: document.getElementById('cfg-whatsapp').value.trim() },
    { clave: 'instagram', valor: document.getElementById('cfg-instagram').value.trim() },
    { clave: 'correo', valor: document.getElementById('cfg-correo').value.trim() },
    { clave: 'direccion_local', valor: document.getElementById('cfg-direccion').value.trim() }
  ];

  try {
    for (const u of updates) {
      await db.from('configuracion').upsert({
        clave: u.clave,
        valor: u.valor,
        updated_at: new Date().toISOString()
      }, { onConflict: 'clave' });
    }
    showToast('Configuración guardada');
  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message, 'error');
  }
}

function wireConfigForm() {
  document.getElementById('config-form').addEventListener('submit', saveConfig);
}

// ============================================
// TOAST
// ============================================
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

// ============================================
// MODAL GENÉRICO
// ============================================
function wireOrderModal() {
  document.getElementById('order-modal-close').addEventListener('click', () => {
    document.getElementById('order-modal').classList.remove('open');
  });
  document.getElementById('order-modal').addEventListener('click', (e) => {
    if (e.target.id === 'order-modal') document.getElementById('order-modal').classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('order-modal').classList.remove('open');
      document.getElementById('product-modal').classList.remove('open');
    }
  });
}

// ============================================
// COMPRAS
// ============================================
const UNIDADES_DISPONIBLES = ['gr', 'unidad', 'unidades', 'paquete', 'paquetes'];

const CATEGORIAS_INGREDIENTES = {
  'chicharrón': 'Carnes', 'chicharron': 'Carnes', 'panceta': 'Carnes',
  'bondiola': 'Carnes', 'costilla': 'Carnes', 'costillas': 'Carnes',
  'chorizo': 'Embutidos', 'morcilla': 'Embutidos',
  'papa': 'Acompañamientos', 'plátano': 'Acompañamientos', 'platano': 'Acompañamientos',
  'maduro': 'Acompañamientos', 'patacón': 'Acompañamientos',
  'patacon': 'Acompañamientos', 'patacones': 'Acompañamientos',
  'cebolla': 'Guacamole', 'tomate': 'Guacamole', 'aguacate': 'Guacamole',
  'limón': 'Guacamole', 'limon': 'Guacamole', 'cilantro': 'Guacamole',
  'mango': 'Ceviche', 'pimentón': 'Ceviche', 'pimenton': 'Ceviche'
};

function categorizar(nombreIngrediente) {
  const n = nombreIngrediente.toLowerCase().trim();
  for (const key in CATEGORIAS_INGREDIENTES) {
    if (n.includes(key)) return CATEGORIAS_INGREDIENTES[key];
  }
  return 'Otros';
}

// Calcular ingredientes para un array de pedidos (confirmados o según filtro)
async function calcIngredientes(pedidos) {
  const { data: recetasData } = await db.from('recetas').select('*');
  const recetas = recetasData || [];
  const recetasMap = {};
  recetas.forEach(r => {
    if (!recetasMap[r.producto_id]) recetasMap[r.producto_id] = [];
    recetasMap[r.producto_id].push(r);
  });

  const pedidosPorProducto = {};
  let extrasGuacamole = 0;

  pedidos.forEach(pedido => {
    (pedido.items || []).forEach(item => {
      if (!pedidosPorProducto[item.id]) {
        pedidosPorProducto[item.id] = { nombre: item.nombre, cantidad: 0, extras: 0 };
      }
      pedidosPorProducto[item.id].cantidad += item.cantidad;
      if (item.guacamole_extra) {
        pedidosPorProducto[item.id].extras += item.cantidad;
        extrasGuacamole += item.cantidad;
      }
    });
  });

  const ingredientesTotales = {};
  function addIngrediente(nombre, qty, unidad) {
    const key = nombre.toLowerCase().trim();
    if (!ingredientesTotales[key]) {
      ingredientesTotales[key] = { nombreOriginal: nombre, qty: 0, unidad, categoria: categorizar(nombre) };
    }
    ingredientesTotales[key].qty += qty;
  }

  Object.entries(pedidosPorProducto).forEach(([productoId, info]) => {
    const recetaProducto = recetasMap[productoId] || [];
    recetaProducto.forEach(ing => {
      addIngrediente(ing.nombre_ingrediente, ing.cantidad * info.cantidad, ing.unidad);
    });
  });

  let totalPorcionesGuacamole = 0;
  pedidos.forEach(pedido => {
    (pedido.items || []).forEach(item => {
      let multiplicador = 1;
      const nombre = (item.nombre || '').toLowerCase();
      if (nombre.includes('para 2') || nombre.includes('2-3') || nombre.includes('para dos')) multiplicador = 2;
      else if (nombre.includes('para 4') || nombre.includes('4-5') || nombre.includes('para cuatro')) multiplicador = 4;
      totalPorcionesGuacamole += item.cantidad * multiplicador;
      if (item.guacamole_extra) totalPorcionesGuacamole += item.cantidad;
    });
  });

  const guacamolesNecesarios = Math.ceil(totalPorcionesGuacamole / 8);
  if (guacamolesNecesarios > 0) {
    addIngrediente('Cebolla (guacamole)', guacamolesNecesarios * 0.5, 'unidad');
    addIngrediente('Tomate (guacamole)', guacamolesNecesarios * 1, 'unidad');
    addIngrediente('Aguacate (guacamole)', guacamolesNecesarios * 1, 'unidad');
  }

  return { pedidosPorProducto, ingredientesTotales, extrasGuacamole, guacamolesNecesarios, totalPorcionesGuacamole };
}

function renderIngredientesHTML(pedidosPorProducto, ingredientesTotales, extrasGuacamole, guacamolesNecesarios, totalPorcionesGuacamole) {
  let pedidosHTML = '<div class="pedidos-summary">';
  Object.values(pedidosPorProducto).forEach(p => {
    pedidosHTML += `<div class="pedido-summary-row"><span class="pedido-summary-name">${p.nombre}</span><span class="pedido-summary-qty">${p.cantidad}×</span></div>`;
  });
  if (extrasGuacamole > 0) {
    pedidosHTML += `<div class="pedidos-summary-extras"><strong style="color: var(--gold);">+ ${extrasGuacamole}</strong> guacamole(s) extra solicitado(s)</div>`;
  }
  pedidosHTML += '</div>';

  const ingredientesArr = Object.values(ingredientesTotales);
  const categorias = {};
  ingredientesArr.forEach(ing => {
    if (!categorias[ing.categoria]) categorias[ing.categoria] = [];
    categorias[ing.categoria].push(ing);
  });

  const ordenCategorias = ['Carnes', 'Embutidos', 'Acompañamientos', 'Guacamole', 'Ceviche', 'Otros'];
  const categoriasOrdenadas = ordenCategorias.filter(c => categorias[c]);

  let comprasHTML = '';
  if (categoriasOrdenadas.length === 0) {
    comprasHTML = `<div style="padding:30px;text-align:center;color:var(--cream-soft);opacity:0.7;"><p>No hay recetas configuradas.</p><p style="font-size:0.85rem;opacity:0.7;">Ve a <strong>Menú</strong> y agrega los ingredientes en cada producto.</p></div>`;
  } else {
    categoriasOrdenadas.forEach(cat => {
      comprasHTML += `<div class="compras-categoria"><div class="compras-categoria-title">${cat}</div>`;
      categorias[cat].forEach(ing => {
        comprasHTML += `<div class="compras-item"><span class="compras-item-name">${ing.nombreOriginal}</span><span class="compras-item-qty">${formatQty(ing.qty, ing.unidad)}</span></div>`;
      });
      comprasHTML += '</div>';
    });
    if (guacamolesNecesarios > 0) {
      comprasHTML += `<div class="compras-categoria"><div class="compras-categoria-title">Notas</div><div class="compras-extras-list">· Total guacamoles a preparar: <strong style="color:var(--gold);">${guacamolesNecesarios}</strong> (${totalPorcionesGuacamole} porciones).<br>· Cilantro, limón, vinagre, sal y pimienta al gusto.</div></div>`;
    }
  }

  return { pedidosHTML, comprasHTML };
}

async function loadCompras() {
  const content = document.getElementById('compras-content');
  const empty = document.getElementById('compras-empty');
  const subtext = document.getElementById('compras-subtext');

  try {
    // Filtro de día en compras
    const filtroDia = document.getElementById('compras-filter-dia')?.value || 'activo';

    // Determinar qué pedidos usar
    let pedidosBase;
    let subtextLabel;

    if (filtroDia === 'activo') {
      // Solo los del fin de semana activo
      const aw = getActiveWeekend();
      const activeISO = aw.sabado ? isoDate(aw.sabado) : (aw.domingo ? isoDate(aw.domingo) : null);
      if (activeISO) {
        pedidosBase = ALL_ORDERS.filter(o => o.estado === 'confirmado' && o.fecha_entrega === activeISO);
        subtextLabel = 'Solo pedidos confirmados del fin de semana activo';
      } else {
        pedidosBase = [];
        subtextLabel = 'Sin fin de semana activo';
      }
    } else if (filtroDia === 'sabado') {
      // Próximo sábado confirmados
      const aw = getActiveWeekend();
      // Buscar el sábado más cercano (pasado o futuro)
      const todosLosSabados = ALL_ORDERS
        .filter(o => o.estado === 'confirmado')
        .filter(o => { const d = new Date(o.fecha_entrega+'T00:00:00'); return d.getDay() === 6; });
      // Agrupamos por fecha y tomamos la más reciente
      const fechas = [...new Set(todosLosSabados.map(o => o.fecha_entrega))].sort().reverse();
      if (fechas.length > 0) {
        pedidosBase = todosLosSabados.filter(o => o.fecha_entrega === fechas[0]);
        subtextLabel = `Sábado ${fechas[0]} - confirmados`;
      } else { pedidosBase = []; subtextLabel = 'Sin sábados con pedidos confirmados'; }
    } else if (filtroDia === 'domingo') {
      const todosLosDomingos = ALL_ORDERS
        .filter(o => o.estado === 'confirmado')
        .filter(o => { const d = new Date(o.fecha_entrega+'T00:00:00'); return d.getDay() === 0; });
      const fechas = [...new Set(todosLosDomingos.map(o => o.fecha_entrega))].sort().reverse();
      if (fechas.length > 0) {
        pedidosBase = todosLosDomingos.filter(o => o.fecha_entrega === fechas[0]);
        subtextLabel = `Domingo ${fechas[0]} - confirmados`;
      } else { pedidosBase = []; subtextLabel = 'Sin domingos con pedidos confirmados'; }
    } else {
      // 'todos' = todos los confirmados del fin de semana activo o próximo
      pedidosBase = ALL_ORDERS.filter(o => o.estado === 'confirmado');
      subtextLabel = `Todos los pedidos confirmados (${pedidosBase.length})`;
    }

    subtext.textContent = subtextLabel;

    if (pedidosBase.length === 0) {
      content.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const { pedidosPorProducto, ingredientesTotales, extrasGuacamole, guacamolesNecesarios, totalPorcionesGuacamole } =
      await calcIngredientes(pedidosBase);
    const { pedidosHTML, comprasHTML } = renderIngredientesHTML(pedidosPorProducto, ingredientesTotales, extrasGuacamole, guacamolesNecesarios, totalPorcionesGuacamole);

    const totalFacturado = pedidosBase.reduce((s,o) => s + o.total, 0);

    content.innerHTML = `
      <div class="compras-total-badge">Total confirmado: <strong>${formatPrice(totalFacturado)}</strong></div>
      <div class="compras-grid">
        <div class="compras-card">
          <div class="compras-card-title"><span class="compras-card-title-icon">📋</span> Pedidos confirmados</div>
          <div class="compras-card-sub">Resumen de productos</div>
          ${pedidosHTML}
        </div>
        <div class="compras-card">
          <div class="compras-card-title"><span class="compras-card-title-icon">🛒</span> Lista de compras</div>
          <div class="compras-card-sub">Ingredientes consolidados</div>
          ${comprasHTML}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error cargando compras:', err);
    content.innerHTML = `<div style="padding:40px;text-align:center;color:var(--ember);">Error: ${err.message}</div>`;
  }
}

function wireComprasFilters() {
  const sel = document.getElementById('compras-filter-dia');
  if (sel) sel.addEventListener('change', loadCompras);
}

function formatQty(qty, unidad) {
  if (unidad === 'gr') {
    if (qty >= 1000) return `${(qty / 1000).toFixed(2).replace(/\.?0+$/, '')} kg`;
    return `${Math.round(qty)} gr`;
  }
  if (unidad === 'unidad' || unidad === 'unidades') {
    if (qty % 1 !== 0) return `${qty.toFixed(2).replace(/\.?0+$/, '')} unidades`;
    return `${qty} ${qty === 1 ? 'unidad' : 'unidades'}`;
  }
  if (unidad === 'paquete' || unidad === 'paquetes') {
    if (qty % 1 !== 0) return `${qty.toFixed(1)} paquetes`;
    return `${qty} ${qty === 1 ? 'paquete' : 'paquetes'}`;
  }
  return `${qty} ${unidad}`;
}

// ============================================
// RECETAS
// ============================================
let CURRENT_RECETA = [];

async function loadReceta(productoId) {
  if (!productoId) { CURRENT_RECETA = []; renderRecetaFields(); return; }
  try {
    const { data } = await db.from('recetas').select('*').eq('producto_id', productoId).order('id');
    CURRENT_RECETA = (data || []).map(r => ({
      id: r.id, nombre_ingrediente: r.nombre_ingrediente, cantidad: r.cantidad, unidad: r.unidad
    }));
    renderRecetaFields();
  } catch (err) {
    CURRENT_RECETA = []; renderRecetaFields();
  }
}

function renderRecetaFields() {
  const container = document.getElementById('receta-fields');
  if (!container) return;
  container.innerHTML = CURRENT_RECETA.map((row, i) => `
    <div class="receta-row" data-index="${i}">
      <input type="text" placeholder="Ingrediente (ej: Chicharrón)" value="${row.nombre_ingrediente || ''}" data-field="nombre_ingrediente" />
      <input type="number" step="0.01" min="0" placeholder="Cant." value="${row.cantidad ?? ''}" data-field="cantidad" />
      <select data-field="unidad">
        ${UNIDADES_DISPONIBLES.map(u => `<option value="${u}" ${row.unidad === u ? 'selected' : ''}>${u}</option>`).join('')}
      </select>
      <button type="button" class="receta-row-remove" data-action="remove-receta" data-index="${i}" aria-label="Eliminar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', () => {
      const row = el.closest('.receta-row');
      const idx = Number(row.dataset.index);
      const field = el.dataset.field;
      let val = el.value;
      if (field === 'cantidad') val = val === '' ? '' : Number(val);
      CURRENT_RECETA[idx][field] = val;
    });
  });

  container.querySelectorAll('[data-action="remove-receta"]').forEach(btn => {
    btn.addEventListener('click', () => {
      CURRENT_RECETA.splice(Number(btn.dataset.index), 1);
      renderRecetaFields();
    });
  });
}

function wireRecetaAddBtn() {
  const btn = document.getElementById('receta-add-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    CURRENT_RECETA.push({ nombre_ingrediente: '', cantidad: '', unidad: 'gr' });
    renderRecetaFields();
  });
}

async function saveReceta(productoId) {
  if (!productoId) return;
  try {
    await db.from('recetas').delete().eq('producto_id', productoId);
    const filas = CURRENT_RECETA
      .filter(r => r.nombre_ingrediente && r.nombre_ingrediente.trim() && r.cantidad > 0)
      .map(r => ({ producto_id: productoId, nombre_ingrediente: r.nombre_ingrediente.trim(), cantidad: Number(r.cantidad), unidad: r.unidad || 'gr' }));
    if (filas.length > 0) {
      const { error } = await db.from('recetas').insert(filas);
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error guardando receta:', err);
    showToast('Producto guardado, pero falló al guardar receta: ' + err.message, 'error');
  }
}

// ============================================
// IMPRIMIR
// ============================================
function wirePrintCompras() {
  const btn = document.getElementById('print-compras-btn');
  if (!btn) return;
  btn.addEventListener('click', () => window.print());
}

// ============================================
// POBLAR SELECTS DE HORA
// ============================================
function getServiceTimeSlots() {
  const slots = [];
  const [sh, sm] = SERVICE_START.split(':').map(Number);
  const [eh, em] = SERVICE_END.split(':').map(Number);
  let h = sh, m = sm;
  while (h < eh || (h === eh && m <= em)) {
    slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    m += SLOT_INTERVAL_MIN;
    if (m >= 60) { m = 0; h++; }
  }
  return slots;
}

function buildHoraOptions(selectId, includeAll = true) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const slots = getServiceTimeSlots();
  sel.innerHTML = (includeAll ? '<option value="">Todas las horas</option>' : '') +
    slots.map(s => `<option value="${s}">${formatTime12h(s)}</option>`).join('');
}

// ============================================
// EXPORT EXCEL DESDE DASHBOARD ACTIVO
// ============================================
function wireExportBtn() {
  const btn = document.getElementById('export-excel-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const aw = getActiveWeekend();
    const activeISO = aw.sabado ? isoDate(aw.sabado) : (aw.domingo ? isoDate(aw.domingo) : null);
    if (!activeISO) { showToast('No hay fin de semana activo', 'error'); return; }
    const d = new Date(activeISO + 'T00:00:00');
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const label = `${aw.sabado ? 'Sabado' : 'Domingo'}_${d.getDate()}_${meses[d.getMonth()]}`;
    exportExcelForDate(activeISO, label);
  });
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  wireNav();
  wireFilters();
  wireProductModal();
  wireConfigForm();
  wireOrderModal();
  wireRecetaAddBtn();
  wirePrintCompras();
  wireComprasFilters();
  wireHistorialFilters();
  wireTimeFilter();
  wireExportBtn();

  // Poblar selects de hora
  buildHoraOptions('filter-hora', true);
  buildHoraOptions('hist-hora', true);

  await loadOrders();
  subscribeRealtime();
});
