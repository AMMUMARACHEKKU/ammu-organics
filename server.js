// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Postgres pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Razorpay instance
const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

// create order - stores order in DB (pending) and returns razorpay order id
app.post('/api/checkout/create-order', async (req, res) => {
  try{
    const { items, totals, shipping, coupon } = req.body;
    // create server-side order record
    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const insertOrderText = `INSERT INTO orders(user_id, total_price, status, shipping_state, shipping_district, shipping_city, shipping_pincode, coupon_code)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`;
      const userId = null; // none (guest). Hook auth system to set user id
      const orderRes = await client.query(insertOrderText, [userId, totals.grand, 'pending', shipping.state, shipping.district, shipping.city, shipping.pincode, coupon || null]);
      const orderId = orderRes.rows[0].id;

      // insert order items
      const itemPromises = items.map(it => client.query(
        `INSERT INTO order_items(order_id, product_name, sku, unit_price, qty, total_price) VALUES($1,$2,$3,$4,$5,$6)`,
        [orderId, it.product || it.name, it.sku || null, it.price, it.qty, (it.price * it.qty)]
      ));
      await Promise.all(itemPromises);

      // create razorpay order
      const amountPaise = Math.round((totals.grand) * 100);
      const razorpayOrder = await rzp.orders.create({ amount: amountPaise, currency: 'INR', receipt: 'rcpt_' + orderId, payment_capture: 1 });

      // store razorpay order id in orders table
      await client.query('UPDATE orders SET razorpay_order_id=$1 WHERE id=$2', [razorpayOrder.id, orderId]);

      await client.query('COMMIT');

      res.json({ orderId, razorpayOrderId: razorpayOrder.id, amount: razorpayOrder.amount, key: process.env.RAZORPAY_KEY_ID });
    }catch(e){
      await client.query('ROLLBACK'); throw e;
    }finally{ client.release(); }
  }catch(e){
    console.error(e); res.status(500).json({ error: 'Create order failed' });
  }
});

// verify signature - called after client payment success
app.post('/api/checkout/verify', async (req, res) => {
  try{
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, clientOrderId } = req.body;
    // verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if(expectedSignature !== razorpay_signature) return res.status(400).json({ error: 'Invalid signature' });

    // mark order as paid
    await pool.query('UPDATE orders SET status=$1, payment_id=$2 WHERE id=$3', ['paid', razorpay_payment_id, clientOrderId]);
    res.json({ ok: true, orderId: clientOrderId });
  }catch(e){
    console.error(e); res.status(500).json({ error: 'Verification failed' });
  }
});

// coupon validation
app.post('/api/coupon/validate', async (req, res) => {
  const { code, subtotal } = req.body;
  if(!code) return res.status(400).json({ error: 'Missing code' });
  try{
    const q = await pool.query('SELECT code,type,value,min_amount,expires_at,description FROM coupons WHERE code=$1', [code]);
    const row = q.rows[0];
    if(!row) return res.status(400).json({ error: 'Invalid coupon' });
    if(row.expires_at && new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Coupon expired' });
    if(row.min_amount && subtotal < Number(row.min_amount)) return res.status(400).json({ error: 'Minimum order not met' });
    res.json({ valid: true, code: row.code, type: row.type, value: Number(row.value), desc: row.description||'Coupon applied' });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Coupon check failed' }); }
});

// regions endpoint - serve a JSON with states->districts->cities (expandable)
// For brevity we include Tamil Nadu detailed and placeholders for others; replace/expand with real dataset.
app.get('/api/regions', (req, res) => {
  const data = {
    "Tamil Nadu": {
      "Chennai": ["Chennai","Adyar","T Nagar"],
      "Coimbatore": ["Coimbatore","Peelamedu"],
      "Madurai": ["Madurai","Avaniyapuram"],
      "Tirunelveli": ["Tirunelveli","Palayamkottai"]
    },
    "Kerala": { "Thiruvananthapuram": ["Thiruvananthapuram"] },
    "Karnataka": { "Bengaluru": ["Bengaluru"] },
    "Maharashtra": { "Mumbai": ["Mumbai"] },
    "Other": { "Other District": ["Other City"] }
  };
  res.json(data);
});

// products lookup (optional)
// app.get('/api/products/:sku', ... )   // implement as needed

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>console.log('Server started on', PORT));
