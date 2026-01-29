-- Wallet/refund/admin compatibility migrations (safe, additive)
-- Uses information_schema checks instead of ADD COLUMN IF NOT EXISTS

SET @db := DATABASE();

-- users.wallet_balance
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = @db
      AND table_name = 'users'
      AND column_name = 'wallet_balance'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE users ADD COLUMN wallet_balance DECIMAL(10,2) NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.status
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = @db
      AND table_name = 'orders'
      AND column_name = 'status'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE orders ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT ''PENDING''',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.escrow_required
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = @db
      AND table_name = 'orders'
      AND column_name = 'escrow_required'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE orders ADD COLUMN escrow_required TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- payments table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'payments'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        user_id INT NOT NULL,
        provider VARCHAR(40) NOT NULL,
        provider_ref VARCHAR(255) NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT ''SGD'',
        status VARCHAR(30) NOT NULL DEFAULT ''PENDING'',
        escrow_status VARCHAR(30) NOT NULL DEFAULT ''NONE'',
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_payments_order_id (order_id),
        INDEX idx_payments_user_id (user_id),
        INDEX idx_payments_provider_ref (provider_ref)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- wallet_ledger table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'wallet_ledger'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE wallet_ledger (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        order_id INT NULL,
        payment_id INT NULL,
        type VARCHAR(30) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        balance_after DECIMAL(10,2) NOT NULL,
        ref_type VARCHAR(40) NULL,
        ref_id VARCHAR(100) NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wallet_ledger_user_id (user_id),
        INDEX idx_wallet_ledger_order_id (order_id),
        INDEX idx_wallet_ledger_payment_id (payment_id)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
