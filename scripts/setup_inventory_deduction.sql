USE c372_supermarketdb;

-- 1. Ensure products table has quantity column and uses InnoDB
ALTER TABLE products MODIFY COLUMN quantity INT NOT NULL DEFAULT 0;
ALTER TABLE products ENGINE=InnoDB;

-- 2. Add total_amount column to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ENGINE=InnoDB;

-- 3. Ensure order_items exists with proper structure
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  INDEX (order_id),
  INDEX (product_id)
) ENGINE=InnoDB;

-- 4. Verify setup
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'c372_supermarketdb' 
AND TABLE_NAME IN ('products', 'orders', 'order_items');

-- 5. Check current product quantities
SELECT id, productName, quantity FROM products ORDER BY id;
