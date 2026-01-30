-- Payment enhancements: idempotency, ledger, saved methods, invoices
SET @db := DATABASE();

-- idempotency_keys table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'idempotency_keys'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE idempotency_keys (
        `key` VARCHAR(255) NOT NULL,
        response_json TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`key`)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- accounts table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'accounts'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type VARCHAR(20) NOT NULL,
        balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        UNIQUE KEY uniq_accounts_user_type (user_id, type)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ledger_entries table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'ledger_entries'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE ledger_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        debit_account_id INT NOT NULL,
        credit_account_id INT NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reference_id VARCHAR(100) NULL,
        reference_type VARCHAR(40) NULL,
        notes VARCHAR(255) NULL,
        INDEX idx_ledger_debit (debit_account_id),
        INDEX idx_ledger_credit (credit_account_id),
        INDEX idx_ledger_reference (reference_type, reference_id)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- saved_payment_methods table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'saved_payment_methods'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE saved_payment_methods (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token VARCHAR(255) NOT NULL,
        type VARCHAR(30) NOT NULL,
        last4 VARCHAR(4) NULL,
        expiry VARCHAR(10) NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_saved_methods_user (user_id),
        INDEX idx_saved_methods_default (user_id, is_default)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- invoices table
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'invoices'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT ''FAILED'',
        retry_count INT NOT NULL DEFAULT 0,
        next_retry_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_invoices_status_retry (status, next_retry_at)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- refunds table (if missing)
SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'refunds'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE refunds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payment_id INT NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        reason VARCHAR(255) NULL,
        method VARCHAR(30) NOT NULL DEFAULT ''WALLET'',
        status VARCHAR(30) NOT NULL DEFAULT ''APPROVED'',
        approved_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_refunds_payment (payment_id)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
