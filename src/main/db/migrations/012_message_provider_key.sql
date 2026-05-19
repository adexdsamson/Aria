ALTER TABLE gmail_message ADD COLUMN provider_key TEXT;
ALTER TABLE gmail_message ADD COLUMN account_id TEXT;
ALTER TABLE calendar_event ADD COLUMN provider_key TEXT;
ALTER TABLE calendar_event ADD COLUMN account_id TEXT;
ALTER TABLE approval ADD COLUMN provider_key TEXT;
ALTER TABLE approval ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_gmail_message_provider_account ON gmail_message(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_calendar_event_provider_account ON calendar_event(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_approval_provider_account ON approval(provider_key, account_id);

UPDATE gmail_message
   SET provider_key = 'google',
       account_id = (SELECT email FROM gmail_account LIMIT 1)
 WHERE provider_key IS NULL
   AND EXISTS (SELECT 1 FROM gmail_account);

UPDATE calendar_event
   SET provider_key = 'google',
       account_id = (SELECT email FROM calendar_account LIMIT 1)
 WHERE provider_key IS NULL
   AND EXISTS (SELECT 1 FROM calendar_account);

UPDATE approval
   SET provider_key = 'google',
       account_id = (SELECT email FROM gmail_account LIMIT 1)
 WHERE provider_key IS NULL
   AND kind = 'email_send'
   AND EXISTS (SELECT 1 FROM gmail_account);

UPDATE approval
   SET provider_key = 'google',
       account_id = (SELECT email FROM calendar_account LIMIT 1)
 WHERE provider_key IS NULL
   AND kind = 'calendar_change'
   AND EXISTS (SELECT 1 FROM calendar_account);

INSERT OR IGNORE INTO provider_account (
  account_id, provider_key, display_email, status, capabilities_json
)
SELECT email, 'google', email, 'ok', '{"mail":true,"calendar":false}'
  FROM gmail_account;

INSERT OR IGNORE INTO provider_account (
  account_id, provider_key, display_email, status, capabilities_json
)
SELECT email, 'google', email, 'ok', '{"mail":false,"calendar":true}'
  FROM calendar_account;

UPDATE provider_account
   SET capabilities_json = '{"mail":true,"calendar":true}'
 WHERE provider_key = 'google'
   AND account_id IN (SELECT email FROM gmail_account)
   AND account_id IN (SELECT email FROM calendar_account);

PRAGMA user_version = 12;
