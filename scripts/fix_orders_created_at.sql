USE c372_supermarketdb;

-- Add created_at column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Update existing orders with a timestamp if they don't have one
UPDATE orders SET created_at = NOW() WHERE created_at IS NULL;

-- Verify
SELECT * FROM orders LIMIT 5;
