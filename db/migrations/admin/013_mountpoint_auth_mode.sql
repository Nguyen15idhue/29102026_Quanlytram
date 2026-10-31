ALTER TABLE mountpoints
  ADD COLUMN auth_mode ENUM('ntrip_account','password_only') NOT NULL DEFAULT 'ntrip_account',
  ADD COLUMN password_hash VARCHAR(255) NULL;
