SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE web_users ADD COLUMN company_id BIGINT UNSIGNED NULL AFTER parent_user_id, ADD KEY idx_web_users_company (company_id), ADD CONSTRAINT fk_web_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL',
    'DO 0'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'web_users'
    AND column_name = 'company_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO companies (code, name, status, created_by)
WITH RECURSIVE up AS (
  SELECT a.id AS start_id, a.id AS node_id, a.parent_user_id, 0 AS depth
    FROM web_users a
    JOIN roles r ON r.id = a.role_id
   WHERE r.code = 'admin'
  UNION ALL
  SELECT up.start_id, p.id, p.parent_user_id, up.depth + 1
    FROM up
    JOIN web_users p ON p.id = up.parent_user_id
),
admin_chain AS (
  SELECT up.start_id, up.node_id, up.depth
    FROM up
    JOIN web_users w ON w.id = up.node_id
    JOIN roles r ON r.id = w.role_id
   WHERE r.code = 'admin'
),
top_admin AS (
  SELECT start_id, node_id,
         ROW_NUMBER() OVER (PARTITION BY start_id ORDER BY depth DESC) AS rn
    FROM admin_chain
)
SELECT w.username,
       COALESCE(NULLIF(w.display_name, ''), w.username),
       'active',
       w.created_by
  FROM top_admin t
  JOIN web_users w ON w.id = t.node_id
 WHERE t.rn = 1
   AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.code = w.username);

UPDATE web_users u
  JOIN (
    WITH RECURSIVE tree AS (
      SELECT w.id AS root_id, w.id AS member_id
        FROM web_users w
        JOIN companies c ON c.code = w.username
        JOIN roles r ON r.id = w.role_id
       WHERE r.code = 'admin'
      UNION ALL
      SELECT t.root_id, w.id
        FROM tree t
        JOIN web_users w ON w.parent_user_id = t.member_id
       WHERE w.company_id IS NULL
    )
    SELECT member_id, MIN(root_id) AS root_id
      FROM tree
     GROUP BY member_id
  ) m ON m.member_id = u.id
  JOIN web_users root ON root.id = m.root_id
  JOIN companies c ON c.code = root.username
   SET u.company_id = c.id
 WHERE u.company_id IS NULL;

INSERT INTO company_backfill_reports (entity_type, entity_id, reason)
SELECT 'web_user', CAST(u.id AS CHAR),
       CASE
         WHEN u.parent_user_id IS NULL THEN 'no_parent'
         ELSE 'owner_without_company'
       END
  FROM web_users u
  JOIN roles r ON r.id = u.role_id
 WHERE r.code IN ('admin', 'user')
   AND u.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'web_user'
        AND b.entity_id = CAST(u.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = CASE
              WHEN u.parent_user_id IS NULL THEN 'no_parent'
              ELSE 'owner_without_company'
            END
   );
