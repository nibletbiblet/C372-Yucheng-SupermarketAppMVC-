-- refund_requests table (safe, additive)
-- Uses information_schema checks instead of CREATE TABLE IF NOT EXISTS

SET @db := DATABASE();

SET @tbl_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = @db
      AND table_name = 'refund_requests'
);
SET @sql := IF(
    @tbl_exists = 0,
    'CREATE TABLE refund_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        user_id INT NOT NULL,
        requested_amount DECIMAL(10,2) NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT ''PENDING'',
        admin_id INT NULL,
        admin_note TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_refund_requests_order_id (order_id),
        INDEX idx_refund_requests_user_id (user_id),
        INDEX idx_refund_requests_status (status)
    ) ENGINE=InnoDB',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
