DROP TABLE IF EXISTS gmail_account;
DROP TABLE IF EXISTS calendar_account;

CREATE VIEW gmail_account_view AS
  SELECT account_id AS email,
         display_email,
         status,
         last_synced_at,
         last_error,
         created_at AS connected_at,
         identity_set_json
    FROM provider_account
   WHERE provider_key = 'google'
     AND json_extract(capabilities_json, '$.mail') = 1;

CREATE VIEW calendar_account_view AS
  SELECT account_id AS email,
         display_email,
         status,
         last_synced_at,
         last_error,
         created_at AS connected_at,
         identity_set_json
    FROM provider_account
   WHERE provider_key = 'google'
     AND json_extract(capabilities_json, '$.calendar') = 1;
