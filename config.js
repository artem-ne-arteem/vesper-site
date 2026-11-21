// Подключение к Supabase — тот же проект, что у приложения.
// Ключ publishable публичный: данные защищают правила RLS из supabase/schema.sql.
export const SUPABASE_URL = 'https://zifsycecmanohfiwmqru.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_fz_bIVIqoMAYRIf415WKlA_oWCkjtGv';

// Куда вести тех, у кого ещё нет приложения (например, пост в Telegram-канале с инструкцией).
// Пусто — кнопка «Как установить» скрыта.
export const INSTALL_URL = '';
