USE c372_supermarketdb;

-- Check current structure
DESCRIBE orders;

-- Add missing columns
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending';

-- Ensure InnoDB engine
ALTER TABLE orders ENGINE=InnoDB;
ALTER TABLE products ENGINE=InnoDB;

-- Verify
DESCRIBE orders;
SELECT * FROM orders LIMIT 5;
