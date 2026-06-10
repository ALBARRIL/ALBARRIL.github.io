// ============================================
// SUPABASE CLIENT - AL BARRIL
// ============================================

const SUPABASE_URL = 'https://ihveslrseeykhtrsatnj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlodmVzbHJzZWV5a2h0cnNhdG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTczNTMsImV4cCI6MjA5MjIzMzM1M30.qiLdD0LAH1AVtuMWmX6CyBYPrDGZ9bE5LHFkmf8Pp-g';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// CARRITO (POR SESIÓN)
// ============================================

function getSessionId() {
  let id = sessionStorage.getItem('albarril_session');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).substring(2, 12);
    sessionStorage.setItem('albarril_session', id);
  }
  return id;
}

const Cart = {
  key() {
    return 'albarril_cart_' + getSessionId();
  },

  get() {
    try {
      return JSON.parse(localStorage.getItem(this.key()) || '[]');
    } catch {
      return [];
    }
  },

  save(items) {
    localStorage.setItem(this.key(), JSON.stringify(items));
    this.updateBadge();
  },

  add(product) {
    const items = this.get();
    const existing = items.find(i => i.id === product.id);
    if (existing) {
      existing.cantidad += 1;
    } else {
      items.push({
        id: product.id,
        nombre: product.nombre,
        descripcion: product.descripcion,
        precio: product.precio,
        imagen_url: product.imagen_url,
        cantidad: 1
      });
    }
    this.save(items);
  },

  increment(id) {
    const items = this.get();
    const item = items.find(i => i.id === id);
    if (item) item.cantidad += 1;
    this.save(items);
  },

  decrement(id) {
    const items = this.get();
    const item = items.find(i => i.id === id);
    if (item) {
      item.cantidad -= 1;
      if (item.cantidad <= 0) {
        return this.save(items.filter(i => i.id !== id));
      }
    }
    this.save(items);
  },

  remove(id) {
    this.save(this.get().filter(i => i.id !== id));
  },

  toggleExtra(id, extraName) {
    const items = this.get();
    const item = items.find(i => i.id === id);
    if (item) item[extraName] = !item[extraName];
    this.save(items);
  },

  clear() {
    this.save([]);
  },

  count() {
    return this.get().reduce((sum, i) => sum + i.cantidad, 0);
  },

  total() {
    return this.get().reduce((sum, i) => {
      const extra = i.guacamole_extra ? 1500 : 0; // Guacamole extra $1.500
      return sum + ((i.precio + extra) * i.cantidad);
    }, 0);
  },

  getQuantity(id) {
    const item = this.get().find(i => i.id === id);
    return item ? item.cantidad : 0;
  },

  hasExtra(id, extraName) {
    const item = this.get().find(i => i.id === id);
    return item ? !!item[extraName] : false;
  },

  updateBadge() {
    const badge = document.getElementById('cart-badge');
    const fab = document.getElementById('cart-fab');
    if (!badge || !fab) return;
    const count = this.count();
    if (count > 0) {
      badge.textContent = count;
      fab.classList.add('visible');
    } else {
      fab.classList.remove('visible');
    }
  }
};

// ============================================
// AUTH ADMIN (simple, client-side)
// ============================================

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const Auth = {
  async login(usuario, password) {
    const passwordHash = await sha256(password);
    const { data, error } = await db
      .from('admins')
      .select('*')
      .eq('usuario', usuario)
      .eq('password_hash', passwordHash)
      .maybeSingle();
    if (error || !data) return false;
    sessionStorage.setItem('albarril_admin', JSON.stringify({ usuario: data.usuario, ts: Date.now() }));
    return true;
  },
  isLoggedIn() {
    const session = sessionStorage.getItem('albarril_admin');
    if (!session) return false;
    try {
      const { ts } = JSON.parse(session);
      if (Date.now() - ts > 8 * 60 * 60 * 1000) {
        sessionStorage.removeItem('albarril_admin');
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },
  logout() {
    sessionStorage.removeItem('albarril_admin');
  }
};

// ============================================
// UTILS
// ============================================

function formatPrice(price) {
  return '$' + Math.round(price).toLocaleString('es-CO');
}

// ============================================
// FECHAS DISPONIBLES
// Lógica: sábados y domingos disponibles.
// Corte de pedidos: día anterior hasta medianoche (23:59).
// Es decir, el mismo día de servicio NO se puede pedir.
// ============================================

/**
 * Devuelve los próximos `count` días que sean sábado (6) o domingo (0),
 * ordenados cronológicamente, excluyendo los que ya cerraron (es decir,
 * si hoy es sábado o domingo, ese día ya no aparece porque el corte
 * fue ayer a medianoche).
 */
function getAvailableDates(count = 4) {
  const results = [];
  const now = new Date();
  // Hora actual en Colombia (UTC-5)
  // Usamos hora local del navegador (que debería estar en Colombia)
  
  // Empezamos desde mañana, porque el corte es día anterior medianoche
  // Si hoy es viernes y son las 10pm, mañana sábado aún aparece
  // Si hoy es sábado (mismo día de servicio), ya no aparece el sábado de hoy
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  let current = new Date(now);
  current.setHours(0, 0, 0, 0);

  // Avanzamos hasta encontrar `count` sábados/domingos futuros
  // Un día es válido si: es sábado o domingo Y es al menos mañana
  // (el mismo día de servicio no se puede pedir — corte fue medianoche anterior)
  let checked = 0;
  while (results.length < count && checked < 60) {
    const day = current.getDay(); // 0=domingo, 6=sábado
    if ((day === 0 || day === 6) && current >= tomorrow) {
      results.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
    checked++;
  }
  return results;
}

function formatDateLong(date) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${dias[date.getDay()]} ${date.getDate()} de ${meses[date.getMonth()]}`;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTimeSlots() {
  // 13:30 a 15:00 cada 30 min
  const slots = [];
  let h = 13, m = 30;
  while (h < 15 || (h === 15 && m === 0)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 30;
    if (m >= 60) { m = 0; h += 1; }
  }
  return slots;
}

function formatTime12h(time24) {
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Devuelve un string recordatorio de hasta cuándo se puede pedir
 * para una fecha dada (ISO string YYYY-MM-DD).
 * Ej: "Pedidos para el sábado 24 de mayo cierran el viernes 23 a medianoche."
 */
function getOrderDeadlineText(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const serviceDate = new Date(y, mo - 1, d);
  const deadline = new Date(serviceDate);
  deadline.setDate(deadline.getDate() - 1);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dayName = dias[serviceDate.getDay()];
  const deadlineName = dias[deadline.getDay()];
  return `Pedidos para el ${dayName} cierran el ${deadlineName} ${deadline.getDate()} de ${meses[deadline.getMonth()]} a medianoche.`;
}
