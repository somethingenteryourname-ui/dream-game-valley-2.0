require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Stripe = require('stripe');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// --- Stripe webhook needs the RAW body, so it must be registered BEFORE express.json() ---
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Stripe not configured');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    db.prepare(`UPDATE orders SET status = 'paid' WHERE stripe_session_id = ?`).run(session.id);
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-going-live',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- File uploads (admin game files) ---
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// --- Auth helpers ---
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admins only.' });
  next();
}

// ============ AUTH ============

// Regular sign up (buyers). Admin is created separately via /api/admin/setup.
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and an 8+ character password are required.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'An account with that email already exists.' });

  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  req.session.userId = info.lastInsertRowid;
  req.session.isAdmin = false;
  res.json({ ok: true, email });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });
  req.session.userId = user.id;
  req.session.isAdmin = !!user.is_admin;
  res.json({ ok: true, email: user.email, isAdmin: !!user.is_admin });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, isAdmin: !!req.session.isAdmin, email: req.session.userEmail });
});

// One-time admin account creation. Requires the secret ADMIN_SETUP_KEY that
// only YOU know (set it in your .env file — never share it). This is how
// you set your own admin password; it is never generated or seen by anyone else.
app.post('/api/admin/setup', async (req, res) => {
  const { email, password, setupKey } = req.body;
  const alreadyHasAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
  if (alreadyHasAdmin) {
    return res.status(400).json({ error: 'An admin account already exists.' });
  }
  if (!process.env.ADMIN_SETUP_KEY || setupKey !== process.env.ADMIN_SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid setup key.' });
  }
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and an 8+ character password are required.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, 1)').run(email, hash);
  req.session.userId = info.lastInsertRowid;
  req.session.isAdmin = true;
  res.json({ ok: true, email });
});

// ============ GAMES (public catalog) ============

app.get('/api/games', (req, res) => {
  const games = db.prepare('SELECT id, title, description, price_cents, created_at FROM games ORDER BY created_at DESC').all();
  res.json(games);
});

// ============ ADMIN: add / remove games ============

app.post('/api/admin/games', requireLogin, requireAdmin, upload.single('gameFile'), (req, res) => {
  const { title, description, priceDollars } = req.body;
  if (!title || !description || !priceDollars) {
    return res.status(400).json({ error: 'Title, description, and price are required.' });
  }
  const price_cents = Math.round(parseFloat(priceDollars) * 100);
  const filePath = req.file ? req.file.filename : null;
  const info = db.prepare(
    'INSERT INTO games (title, description, price_cents, file_path) VALUES (?, ?, ?, ?)'
  ).run(title, description, price_cents, filePath);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/admin/games/:id', requireLogin, requireAdmin, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (game && game.file_path) {
    const full = path.join(__dirname, 'uploads', game.file_path);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ CHECKOUT (Stripe) ============

app.post('/api/checkout/:gameId', requireLogin, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to .env.' });

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Letting Stripe decide payment methods (in your Stripe Dashboard settings)
      // is what gives buyers cards, wallets, bank options, etc. automatically.
      payment_method_types: undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: game.title, description: game.description },
          unit_amount: game.price_cents,
        },
        quantity: 1,
      }],
      success_url: `${req.protocol}://${req.get('host')}/?purchase=success&game=${game.id}`,
      cancel_url: `${req.protocol}://${req.get('host')}/?purchase=cancelled`,
      metadata: { userId: String(req.session.userId), gameId: String(game.id) },
      automatic_tax: { enabled: process.env.ENABLE_STRIPE_TAX === 'true' },
    });

    db.prepare(
      'INSERT INTO orders (user_id, game_id, stripe_session_id, status, amount_cents) VALUES (?, ?, ?, ?, ?)'
    ).run(req.session.userId, game.id, checkoutSession.id, 'pending', game.price_cents);

    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start checkout: ' + err.message });
  }
});

// ============ DOWNLOAD (only after a paid order) ============

app.get('/api/download/:gameId', requireLogin, (req, res) => {
  const order = db.prepare(
    `SELECT * FROM orders WHERE user_id = ? AND game_id = ? AND status = 'paid' ORDER BY created_at DESC LIMIT 1`
  ).get(req.session.userId, req.params.gameId);
  if (!order) return res.status(403).json({ error: 'No paid order found for this game.' });

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game || !game.file_path) return res.status(404).json({ error: 'File not available.' });

  res.download(path.join(__dirname, 'uploads', game.file_path), `${game.title}${path.extname(game.file_path)}`);
});

app.get('/api/my-orders', requireLogin, (req, res) => {
  const orders = db.prepare(
    `SELECT o.id, o.status, o.amount_cents, g.title, g.id as game_id
     FROM orders o JOIN games g ON g.id = o.game_id
     WHERE o.user_id = ? ORDER BY o.created_at DESC`
  ).all(req.session.userId);
  res.json(orders);
});

app.listen(PORT, () => {
  console.log(`Game marketplace running at http://localhost:${PORT}`);
});
