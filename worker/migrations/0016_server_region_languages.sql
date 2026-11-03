ALTER TABLE servers ADD COLUMN region TEXT;
ALTER TABLE servers ADD COLUMN languages_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(languages_json) AND json_type(languages_json) = 'array');
