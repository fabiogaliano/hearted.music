-- Make user_preferences.theme nullable (null = user hasn't chosen yet)
ALTER TABLE user_preferences
  ALTER COLUMN theme DROP DEFAULT,
  ALTER COLUMN theme DROP NOT NULL;
