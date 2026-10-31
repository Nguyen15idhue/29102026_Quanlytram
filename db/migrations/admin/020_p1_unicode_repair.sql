UPDATE stations
   SET notes = CONCAT('Trạm thật ', name)
 WHERE id IN (79, 80)
   AND notes LIKE '%?%';
