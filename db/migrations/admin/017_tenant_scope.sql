ALTER TABLE role_permissions
  MODIFY COLUMN scope ENUM('all','subtree','tenant','own','none') NOT NULL DEFAULT 'none';
