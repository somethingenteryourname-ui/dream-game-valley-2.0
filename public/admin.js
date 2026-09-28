async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function init() {
  const me = await api('/api/me');
  if (!me.loggedIn) {
    // Might be the very first admin setup, or just a normal visitor.
    document.getElementById('setupBox').classList.remove('hidden');
    return;
  }
  if (me.isAdmin) {
    document.getElementById('adminOnlyBox').classList.remove('hidden');
    loadOwnedGames();
  } else {
    document.getElementById('notAllowedBox').classList.remove('hidden');
  }
}

async function doAdminSetup(e) {
  e.preventDefault();
  try {
    await api('/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupKey: document.getElementById('setupKey').value,
        email: document.getElementById('setupEmail').value,
        password: document.getElementById('setupPassword').value,
      }),
    });
    location.reload();
  } catch (err) {
    document.getElementById('setupError').textContent = err.message;
  }
  return false;
}

async function addGame(e) {
  e.preventDefault();
  const form = new FormData();
  form.append('title', document.getElementById('title').value);
  form.append('description', document.getElementById('description').value);
  form.append('priceDollars', document.getElementById('price').value);
  const file = document.getElementById('gameFile').files[0];
  if (file) form.append('gameFile', file);

  try {
    await api('/api/admin/games', { method: 'POST', body: form });
    location.reload();
  } catch (err) {
    document.getElementById('addError').textContent = err.message;
  }
  return false;
}

async function loadOwnedGames() {
  const games = await api('/api/games');
  const list = document.getElementById('ownedGames');
  list.innerHTML = games.map(g => `
    <li>
      <span>${g.title} — $${(g.price_cents / 100).toFixed(2)}</span>
      <button class="secondary" onclick="removeGame(${g.id})">Remove</button>
    </li>
  `).join('') || '<p style="color:var(--muted)">No games yet.</p>';
}

async function removeGame(id) {
  if (!confirm('Remove this game?')) return;
  await api(`/api/admin/games/${id}`, { method: 'DELETE' });
  loadOwnedGames();
}

init();
