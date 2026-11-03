ALTER TABLE servers ADD COLUMN regions_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(regions_json) AND json_type(regions_json) = 'array');

UPDATE servers
SET regions_json = CASE
  WHEN status = 'pending' THEN '["eu-west"]'
  WHEN region IS NOT NULL AND region <> '' AND region <> 'multiple' THEN json_array(region)
  ELSE '[]'
END;

ALTER TABLE servers DROP COLUMN region;
