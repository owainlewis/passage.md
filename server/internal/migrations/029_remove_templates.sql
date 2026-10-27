-- Remove templates.
--
-- Templates were a separate list of Markdown starters. Nothing written in one
-- is thrown away: each saved template becomes an ordinary document for its
-- owner, keeping its creation and update times, before the table is dropped.
-- A template body without a heading gets the template title as one, so the
-- new document is still recognisable in the list.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
  IF to_regclass('templates') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO documents (owner_user_id, public_id, title, body, created_at, updated_at)
  SELECT owner_user_id,
         replace(gen_random_uuid()::text, '-', ''),
         CASE WHEN ltrim(body, E' \t\n') LIKE '#%'
              THEN coalesce(nullif(trim(regexp_replace(split_part(ltrim(body, E' \t\n'), E'\n', 1), '^#{1,6}\s*', '')), ''), title)
              ELSE title
         END,
         CASE WHEN ltrim(body, E' \t\n') LIKE '#%'
              THEN body
              ELSE '# ' || title || E'\n\n' || body
         END,
         created_at,
         updated_at
  FROM templates;
END
$$;

DROP TABLE IF EXISTS templates;
