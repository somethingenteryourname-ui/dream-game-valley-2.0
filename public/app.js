let currentUser = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function loadMe() {
  const me = await api('/api/me');
  currentUser = me;
  renderAuthArea();
}

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (currentUser && currentUser.loggedIn) {
    el.innerHTML = `
      ${currentUser.isAdmin ? '<a href="admin.html"><button class="secondary">Admin panel</button></a>' : ''}
      <button class="secondary" onclick="logout()">Sign out</button>
    `;
  } else {
    el.innerHTML = `<button onclick="openModal()">Sign in / Sign up</button>`;
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  location.reload();
}

function openModal() { document.getElementById('authModal').classList.remove('hidden'); }
function closeModal() { document.getElementById('authModal').classList.add('hidden'); }
function showTab(which) {
  document.getElementById('tabLogin').classList.toggle('active', which === 'login');
  document.getElementById('tabSignup').classList.toggle('active', which === 'signup');
  document.getElementById('loginForm').classList.toggle('hidden', which !== 'login');
  document.getElementById('signupForm').classList.toggle('hidden', which !== 'signup');
}

async function doLogin(e) {
  e.preventDefault();
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value,
      }),
    });
    location.reload();
  } catch (err) {
    document.getElementById('authError').textContent = err.message;
  }
  return false;
}

async function doSignup(e) {
  e.preventDefault();
  try {
    await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
      }),
    });
    location.reload();
  } catch (err) {
    document.getElementById('authError').textContent = err.message;
  }
  return false;
}

async function loadGames() {
  const games = await api('/api/games');
  const grid = document.getElementById('gameList');
  if (games.length === 0) {
    grid.innerHTML = '<p style="color:#9a9db0">No games listed yet.</p>';
    return;
  }
  grid.innerHTML = games.map(g => `
    <div class="game-card">
      <h3>${escapeHtml(g.title)}</h3>
      <p>${escapeHtml(g.description)}</p>
      <div class="price">$${(g.price_cents / 100).toFixed(2)}</div>
      <button onclick="buyGame(${g.id})">Buy</button>
    </div>
  `).join('');
}

async function buyGame(gameId) {
  if (!currentUser || !currentUser.loggedIn) {
    openModal();
    return;
  }
  try {
    const { url } = await api(`/api/checkout/${gameId}`, { method: 'POST' });
    window.location.href = url;
  } catch (err) {
    document.getElementById('message').textContent = err.message;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function checkPurchaseBanner() {
  const params = new URLSearchParams(location.search);
  const msg = document.getElementById('message');
  if (params.get('purchase') === 'success') {
    msg.textContent = 'Thanks! Your purchase went through — check "my orders" via the API, or add a downloads page.';
  } else if (params.get('purchase') === 'cancelled') {
    msg.textContent = 'Checkout was cancelled.';
  }
}

loadMe();
loadGames();
checkPurchaseBanner();
