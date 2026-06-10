// ============================================
// MAIN.JS - Lógica de la página principal
// ============================================

const PRODUCT_IMAGE_MAP = {
  'Picada de la Casa': 'assets/picadapersonal.jpeg',
  'Picada Personal': 'assets/picadapersonal.jpeg',
  'Picada para 2': 'assets/picada-surtida.jpg',
  'Picada para 2-3': 'assets/picada-surtida.jpg',
  'Picada para 4': 'assets/picada-surtida.jpg',
  'Picada para 4-5': 'assets/picada-surtida.jpg',
  'Chicharronada': 'assets/chicharron-2.jpg',
  'Bondiola': 'assets/bondiola.jpg',
  'Costillitas': 'assets/costillas-1.jpg',
  'Costillitas Carnudas': 'assets/costillas-1.jpg',
  'Guacamole': 'assets/guacamole.jpeg',
};

function resolveImage(product) {
  if (product.imagen_url && product.imagen_url.trim()) return product.imagen_url;
  return PRODUCT_IMAGE_MAP[product.nombre] || 'assets/picada-surtida.jpg';
}

// ============================================
// CARGAR PRODUCTOS
// ============================================

async function loadProducts() {
  const grid = document.getElementById('menu-grid');
  try {
    const { data, error } = await db
      .from('productos')
      .select('*')
      .eq('activo', true)
      .order('orden', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) {
      grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; opacity: 0.6;">Pronto tendremos novedades en el menú.</p>';
      return;
    }

    grid.innerHTML = data.map((p, i) => renderProductCard(p, i)).join('');
    wireProductCards();
    observeFadeIn();
  } catch (err) {
    console.error('Error cargando productos:', err);
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--ember);">No pudimos cargar el menú. Revisa tu conexión.</p>';
  }
}

function renderProductCard(p, index) {
  const imgUrl = resolveImage(p);
  const qty = Cart.getQuantity(p.id);
  const hasExtra = Cart.hasExtra(p.id, 'guacamole_extra');
  const delay = index * 80;

  const isGuacamole = p.nombre.toLowerCase().includes('guacamole');

  return `
    <article class="product-card" data-id="${p.id}" style="transition-delay: ${delay}ms;">
      <div class="product-image-wrap">
        <img class="product-image" src="${imgUrl}" alt="${p.nombre}" loading="lazy" />
        <div class="product-badge">${String(index + 1).padStart(2, '0')}</div>
      </div>
      <div class="product-body">
        <h3 class="product-name">${p.nombre}</h3>
        <p class="product-desc">${p.descripcion}</p>
        <div class="product-footer">
          <div class="product-price">${formatPrice(p.precio)}</div>
          <div class="product-action" data-id="${p.id}">
            ${renderAction(p, qty)}
          </div>
        </div>
        ${!isGuacamole ? `
        <label class="product-extra ${qty > 0 ? 'visible' : ''}" data-extra-for="${p.id}">
          <input type="checkbox" data-action="extra-guac" data-id="${p.id}" ${hasExtra ? 'checked' : ''} />
          <span>+ Guacamole extra <strong>($1.500)</strong></span>
        </label>` : ''}
      </div>
    </article>
  `;
}

function renderAction(product, qty) {
  if (qty > 0) {
    return `
      <div class="qty-controls">
        <button class="qty-btn" data-action="dec" data-id="${product.id}" aria-label="Quitar uno">−</button>
        <span class="qty-value">${qty}</span>
        <button class="qty-btn" data-action="inc" data-id="${product.id}" aria-label="Agregar uno">+</button>
      </div>
    `;
  }
  return `
    <button class="btn-add" data-action="add" data-id="${product.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Agregar
    </button>
  `;
}

function wireProductCards() {
  document.querySelectorAll('.product-card').forEach(card => {
    card.querySelectorAll('input[data-action="extra-guac"]').forEach(input => {
      input.addEventListener('change', () => {
        const id = Number(input.dataset.id);
        if (Cart.getQuantity(id) === 0) {
          input.checked = false;
          showToast('Primero agrega el producto al carrito', 'error');
          return;
        }
        Cart.toggleExtra(id, 'guacamole_extra');
      });
    });

    card.querySelectorAll('.product-action').forEach(container => {
      container.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;

        if (action === 'add') {
          const { data } = await db.from('productos').select('*').eq('id', id).maybeSingle();
          if (data) {
            Cart.add(data);
            showToast(`${data.nombre} agregado`);
            refreshCardAction(id);
            updateExtraVisibility(id);
          }
        } else if (action === 'inc') {
          Cart.increment(id);
          refreshCardAction(id);
        } else if (action === 'dec') {
          Cart.decrement(id);
          refreshCardAction(id);
          updateExtraVisibility(id);
        }
      });
    });
  });
}

function updateExtraVisibility(id) {
  const extraLabel = document.querySelector(`.product-extra[data-extra-for="${id}"]`);
  if (!extraLabel) return;
  const qty = Cart.getQuantity(id);
  if (qty > 0) {
    extraLabel.classList.add('visible');
  } else {
    extraLabel.classList.remove('visible');
    const checkbox = extraLabel.querySelector('input');
    if (checkbox) checkbox.checked = false;
  }
}

function refreshCardAction(id) {
  const container = document.querySelector(`.product-action[data-id="${id}"]`);
  if (!container) return;
  const qty = Cart.getQuantity(id);
  container.innerHTML = renderAction({ id }, qty);
}

// ============================================
// FADE-IN ON SCROLL
// ============================================

function observeFadeIn() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
  document.querySelectorAll('.product-card').forEach(el => observer.observe(el));
}

// ============================================
// NAVBAR COMPACT ON SCROLL
// ============================================

function wireNavbar() {
  const navbar = document.getElementById('navbar');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (window.scrollY > 40) navbar.classList.add('compact');
        else navbar.classList.remove('compact');
        ticking = false;
      });
      ticking = true;
    }
  });
}

// ============================================
// LOGIN MODAL
// ============================================

function wireLogin() {
  const btn = document.getElementById('login-btn');
  const modal = document.getElementById('login-modal');
  const closeBtn = document.getElementById('modal-close');
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  btn.addEventListener('click', () => {
    if (Auth.isLoggedIn()) {
      window.location.href = 'admin.html';
      return;
    }
    modal.classList.add('open');
    document.getElementById('login-user').focus();
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.classList.remove('open');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';
    const ok = await Auth.login(user, pass);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ingresar';
    if (ok) {
      window.location.href = 'admin.html';
    } else {
      errorEl.classList.add('visible');
      document.getElementById('login-pass').value = '';
    }
  });
}

// ============================================
// CARGAR CONFIGURACIÓN
// ============================================

async function loadConfig() {
  try {
    const { data } = await db.from('configuracion').select('*');
    if (!data) return;
    const map = {};
    data.forEach(c => map[c.clave] = c.valor);

    const ig = document.getElementById('nav-instagram');
    const wa = document.getElementById('nav-whatsapp');
    if (map.instagram && ig) ig.href = `https://instagram.com/${map.instagram.replace('@', '')}`;
    if (map.whatsapp && wa) wa.href = `https://wa.me/${map.whatsapp.replace(/\D/g, '')}`;

    const direccion = document.getElementById('footer-direccion');
    const correo = document.getElementById('footer-correo');
    if (map.direccion_local && direccion) {
      direccion.innerHTML = `<strong style="color: var(--gold);">Ubicación</strong> · ${map.direccion_local}`;
    }
    if (map.correo && correo) {
      correo.innerHTML = `<strong style="color: var(--gold);">Contacto</strong> · <a href="mailto:${map.correo}">${map.correo}</a>`;
    }
  } catch (err) {
    console.warn('No se pudo cargar configuración:', err);
  }
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
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
}

// ============================================
// BANNER DE PEDIDO EXITOSO
// ============================================

function showOrderSuccessBanner() {
  const raw = sessionStorage.getItem('albarril_order_success');
  if (!raw) return;
  try {
    const info = JSON.parse(raw);
    sessionStorage.removeItem('albarril_order_success');

    const phoneDisplay = '+57 ' + info.telefono.replace(/^57/, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
    const pedidoNum = info.pedido_id ? `#${String(info.pedido_id).padStart(4, '0')}` : '';
    const firstName = info.nombre.split(' ')[0];

    const banner = document.createElement('div');
    banner.className = 'success-banner';
    banner.innerHTML = `
      <button class="success-banner-close" aria-label="Cerrar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="success-banner-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <div class="success-banner-content">
        <div class="success-banner-eyebrow">Pedido ${pedidoNum} recibido</div>
        <h3 class="success-banner-title">¡Gracias, ${firstName}!</h3>
        <p class="success-banner-text">
          Tu pedido quedó registrado con éxito. <strong>Pronto te contactaremos por WhatsApp al ${phoneDisplay}</strong> para confirmarlo y compartirte la cuenta bancaria para el pago.
        </p>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('visible'));

    banner.querySelector('.success-banner-close').addEventListener('click', () => {
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 400);
    });

    setTimeout(() => {
      if (document.body.contains(banner)) {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 400);
      }
    }, 15000);
  } catch (e) {
    console.warn('Error mostrando banner de éxito:', e);
  }
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  Cart.updateBadge();
  wireNavbar();
  wireLogin();
  loadConfig();
  loadProducts();
  showOrderSuccessBanner();
});
