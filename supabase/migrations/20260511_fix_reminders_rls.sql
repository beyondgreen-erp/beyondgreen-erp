-- Fix reminders: disable RLS (app filters by user_email in query)
-- and add to realtime publication for live updates

ALTER TABLE user_reminders DISABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE user_reminders;
