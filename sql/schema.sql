CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  total_price NUMERIC(12,2),
  status VARCHAR(50),
  razorpay_order_id TEXT,
  payment_id TEXT,
  shipping_state TEXT,
  shipping_district TEXT,
  shipping_city TEXT,
  shipping_pincode TEXT,
  coupon_code TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT,
  sku TEXT,
  unit_price NUMERIC(10,2),
  qty INTEGER,
  total_price NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE,
  type VARCHAR(10), -- 'flat' or 'percent'
  value NUMERIC(10,2),
  min_amount NUMERIC(10,2),
  expires_at TIMESTAMP,
  description TEXT
);
