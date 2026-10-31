UPDATE caster_listeners l
  JOIN (
    SELECT u.id
      FROM web_users u
      JOIN roles r ON r.id = u.role_id
     WHERE r.code = 'admin'
     ORDER BY u.id
     LIMIT 1
  ) root_user ON l.owner_web_user_id IS NULL
   SET l.owner_web_user_id = root_user.id;
