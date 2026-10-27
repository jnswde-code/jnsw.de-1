-- Mail-Eingang (worker/mail-eingang.ts, docs/email-versand.md): jede Mail an eine Adresse @jnsw.de,
-- je Message-ID und Empfänger einmal. status: offen (noch nicht bei jw-dev), gesendet, abgewiesen
-- (jw-dev nahm sie mit 4xx nicht an). weitergeleitet: die Kopie an KOPIE_AN ist raus.
-- Kann personenbezogene Daten enthalten; der Text gesendeter Mails wird nach 30 Tagen geleert.
CREATE TABLE IF NOT EXISTS mail_eingang (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  empfaenger TEXT NOT NULL,
  absender TEXT NOT NULL,
  betreff TEXT NOT NULL DEFAULT '',
  datum TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  projekt TEXT NOT NULL,
  anhaenge TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'gesendet', 'abgewiesen')),
  weitergeleitet INTEGER NOT NULL DEFAULT 0,
  versuche INTEGER NOT NULL DEFAULT 0,
  letzter_fehler TEXT,
  eingegangen TEXT NOT NULL,
  gesendet TEXT,
  UNIQUE (message_id, empfaenger)
);
CREATE INDEX IF NOT EXISTS mail_eingang_status ON mail_eingang (status, eingegangen);
