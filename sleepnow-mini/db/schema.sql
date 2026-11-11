-- 晚安开关 云数据库 Schema（WorkBuddy 云服务 / PostgreSQL）
-- 由 cloud-service management 工具逐条执行（每条 exec_sql 仅含单语句）。
-- 本文件仅作为版本化归档，需要重建时按 management.md 规则逐条跑。

-- ===== sleep_logs：用户睡眠记录（私有，owner-only） =====
CREATE TABLE sleep_logs (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id     TEXT        NOT NULL DEFAULT auth.uid(),
  owner_name   TEXT,
  sleep_date   DATE        NOT NULL,
  bed_time     TIME,
  wake_time    TIME,
  duration_min INTEGER,
  quality      INTEGER     DEFAULT 3,
  source       TEXT        DEFAULT 'manual',
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- BUG B08：同一用户同一天只允许一条记录，防止重复提交产生两条
  UNIQUE (owner_id, sleep_date)
);
COMMENT ON TABLE sleep_logs IS '用户睡眠记录（私有，仅本人可读写）';
ALTER TABLE sleep_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sleep_logs TO authenticated, anon;
CREATE POLICY sleep_logs_read_own ON sleep_logs FOR SELECT TO authenticated, anon USING (owner_id = auth.uid());
CREATE POLICY sleep_logs_insert_own ON sleep_logs FOR INSERT TO authenticated, anon WITH CHECK (owner_id = auth.uid());
CREATE POLICY sleep_logs_update_own ON sleep_logs FOR UPDATE TO authenticated, anon USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY sleep_logs_delete_own ON sleep_logs FOR DELETE TO authenticated, anon USING (owner_id = auth.uid());

-- ===== checkins：用户签到打卡（私有，owner-only） =====
CREATE TABLE checkins (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id      TEXT        NOT NULL DEFAULT auth.uid(),
  owner_name    TEXT,
  checkin_date  DATE        NOT NULL,
  streak        INTEGER     DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, checkin_date)
);
-- ===== 增量迁移（线上已建表时逐条执行，每条 exec_sql 仅含单语句） =====
-- 1) 先清理历史重复行（保留 id 最小的一条），否则加唯一约束会失败
DELETE FROM sleep_logs a USING sleep_logs b
  WHERE a.id > b.id AND a.owner_id = b.owner_id AND a.sleep_date = b.sleep_date;
-- 2) 补唯一约束
ALTER TABLE sleep_logs ADD CONSTRAINT sleep_logs_owner_date_key UNIQUE (owner_id, sleep_date);

COMMENT ON TABLE checkins IS '用户签到打卡记录（私有，仅本人可读写）';
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkins TO authenticated, anon;
CREATE POLICY checkins_read_own ON checkins FOR SELECT TO authenticated, anon USING (owner_id = auth.uid());
CREATE POLICY checkins_insert_own ON checkins FOR INSERT TO authenticated, anon WITH CHECK (owner_id = auth.uid());
CREATE POLICY checkins_update_own ON checkins FOR UPDATE TO authenticated, anon USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY checkins_delete_own ON checkins FOR DELETE TO authenticated, anon USING (owner_id = auth.uid());
