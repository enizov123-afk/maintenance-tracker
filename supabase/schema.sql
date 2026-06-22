-- ============================================================
-- Схема БД: Система учёта ТО оборудования
-- Применять в Supabase SQL Editor
-- ============================================================

-- Профили пользователей (расширение auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'production_manager')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Оборудование
CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'decommissioned')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Регламентные работы
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'biannual', 'annual')),
  assignee_role TEXT DEFAULT 'operator',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Журнал выполнения работ
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES maintenance_tasks(id) ON DELETE CASCADE NOT NULL,
  performed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  performed_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL CHECK (status IN ('done', 'skipped')),
  note TEXT,
  verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;

-- profiles: каждый видит всех, редактирует только себя
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- equipment: все авторизованные читают
CREATE POLICY "equipment_select" ON equipment FOR SELECT TO authenticated USING (true);

-- maintenance_tasks: все авторизованные читают
CREATE POLICY "tasks_select" ON maintenance_tasks FOR SELECT TO authenticated USING (true);

-- maintenance_logs: все читают, только НП пишет/обновляет
CREATE POLICY "logs_select" ON maintenance_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "logs_insert" ON maintenance_logs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'production_manager'
    )
  );

CREATE POLICY "logs_update" ON maintenance_logs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'production_manager'
    )
  );

-- ============================================================
-- Функция: автосоздание профиля при регистрации
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'owner')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- Индексы
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_equipment ON maintenance_tasks(equipment_id);
CREATE INDEX IF NOT EXISTS idx_logs_task ON maintenance_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_date ON maintenance_logs(performed_at);

-- ============================================================
-- Уникальный constraint: одна запись на задачу в день (BUG-04)
-- ============================================================
ALTER TABLE maintenance_logs
  DROP CONSTRAINT IF EXISTS maintenance_logs_task_date_unique;
ALTER TABLE maintenance_logs
  ADD CONSTRAINT maintenance_logs_task_date_unique
  UNIQUE (task_id, performed_at);

-- ============================================================
-- View: последний выполненный лог для каждой задачи (BUG-01)
-- Решает проблему лимита 1000 строк Supabase:
-- вместо всех логов — только 1 строка на задачу (макс 93 строки)
-- ============================================================
CREATE OR REPLACE VIEW latest_done_logs AS
SELECT DISTINCT ON (task_id)
  id, task_id, performed_at, performed_by, status, note,
  verified, verified_by, verified_at, created_at
FROM maintenance_logs
WHERE status = 'done'
ORDER BY task_id, performed_at DESC;

-- RLS для view: наследует от maintenance_logs
GRANT SELECT ON latest_done_logs TO authenticated;

-- ============================================================
-- Миграция: фото-верификация (2026-06-18)
-- ============================================================

-- Колонка для хранения URL фото в журнале
ALTER TABLE maintenance_logs ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Storage bucket для фотографий
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance-photos', 'maintenance-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: только production_manager может загружать фото
CREATE POLICY "pm_can_upload_photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'maintenance-photos' AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'production_manager'
  )
);

-- RLS: только production_manager может перезаписывать фото
CREATE POLICY "pm_can_update_photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'maintenance-photos' AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'production_manager'
  )
);

-- RLS: все авторизованные могут читать фото
CREATE POLICY "authenticated_can_read_photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'maintenance-photos');

-- ============================================================
-- Фикс: собственник не мог верифицировать (2026-06-22)
-- UI-проверка роли была исправлена раньше (isPM → isOwner),
-- но RLS-политика logs_update разрешала UPDATE только production_manager.
-- Собственник получал "Ошибка верификации" при попытке записи.
-- ============================================================
CREATE POLICY "owner_can_verify_logs"
ON maintenance_logs FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'owner'
  )
);

-- ============================================================
-- Миграция: отметка работ прямо в карточке оборудования (2026-06-22)
-- Страница /checklist удалена, отметка теперь на /equipment/[id].
-- "Отменить" после подтверждения — реальное удаление строки лога,
-- поэтому нужен DELETE, которого не было вообще ни у кого.
-- ============================================================
CREATE POLICY "pm_can_delete_logs"
ON maintenance_logs FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'production_manager'
  )
);
