-- 빗물받이 촬영기 데이터베이스 설정
-- Supabase → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run 을 누른다.
-- 여러 번 실행해도 안전하다 (이미 있으면 건너뛰거나 다시 만든다).

-- 1. 사진 기록
create table if not exists public.photos (
  id uuid primary key,
  created_at timestamptz not null default now(),
  taken_at timestamptz not null,
  photographer text not null,
  drain_code text not null,
  phase text not null check (phase in ('before', 'after', 'revisit')),
  memo text,
  storage_path text not null,
  thumb_path text not null,
  width integer not null,
  height integer not null,
  -- 빨간 박스: 사진 폭·높이에 대한 비율(0~1)
  box_x real not null,
  box_y real not null,
  box_w real not null,
  box_h real not null,
  lat double precision,
  lng double precision,
  gps_accuracy real,
  capture_mode text not null check (capture_mode in ('auto', 'manual', 'file', 'demo')),
  sharpness real,
  brightness real,
  is_test boolean not null default false,
  device text
);

-- 2. 등급 (사진 1장 × 채점자 1명 = 1줄). 판단 불가면 grade 는 비운다
create table if not exists public.grades (
  photo_id uuid not null references public.photos (id) on delete cascade,
  grader text not null,
  grade smallint check (grade between 0 and 4),
  unusable boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (photo_id, grader),
  check ((unusable and grade is null) or (not unusable and grade is not null))
);

-- 3. 로그인한 팀 계정만 읽고 쓸 수 있게 한다 (로그인 안 한 사람은 아무것도 못 본다)
alter table public.photos enable row level security;
alter table public.grades enable row level security;

drop policy if exists "team access photos" on public.photos;
create policy "team access photos" on public.photos
  for all to authenticated using (true) with check (true);

drop policy if exists "team access grades" on public.grades;
create policy "team access grades" on public.grades
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.photos to authenticated;
grant select, insert, update, delete on public.grades to authenticated;
revoke all on public.photos from anon;
revoke all on public.grades from anon;

-- 4. 사진 파일 저장소 (비공개, 장당 10MB, JPEG만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drain-photos', 'drain-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "team read drain photos" on storage.objects;
create policy "team read drain photos" on storage.objects
  for select to authenticated using (bucket_id = 'drain-photos');

drop policy if exists "team upload drain photos" on storage.objects;
create policy "team upload drain photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'drain-photos');

drop policy if exists "team update drain photos" on storage.objects;
create policy "team update drain photos" on storage.objects
  for update to authenticated using (bucket_id = 'drain-photos') with check (bucket_id = 'drain-photos');

drop policy if exists "team delete drain photos" on storage.objects;
create policy "team delete drain photos" on storage.objects
  for delete to authenticated using (bucket_id = 'drain-photos');

-- 5. AI 채점 결과 (PC 뷰어의 AI 채점 탭). 실행 1회마다 ai_runs 1줄, 사진마다 ai_grades 1줄
create table if not exists public.ai_runs (
  run_id text primary key,
  label text not null,
  model text not null,
  mode text not null check (mode in ('zero', 'few')),
  prompt_version text not null,
  example_ids uuid[] not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_grades (
  run_id text not null references public.ai_runs (run_id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete cascade,
  grade smallint check (grade between 0 and 4),
  unusable boolean not null default false,
  is_drain boolean,
  covered_percent smallint,
  confidence real,
  causes text[],
  reason text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  primary key (run_id, photo_id)
);

alter table public.ai_runs enable row level security;
alter table public.ai_grades enable row level security;

drop policy if exists "team access ai runs" on public.ai_runs;
create policy "team access ai runs" on public.ai_runs
  for all to authenticated using (true) with check (true);

drop policy if exists "team access ai grades" on public.ai_grades;
create policy "team access ai grades" on public.ai_grades
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.ai_runs to authenticated;
grant select, insert, update, delete on public.ai_grades to authenticated;
revoke all on public.ai_runs from anon;
revoke all on public.ai_grades from anon;

-- 6. '신고 필요' 표시 (2026-10-02 추가): 빗물받이 아래(덮개 틈 안쪽)에 쌓여 시민이 치울 수 없는 쓰레기.
--    등급과 별개로 사람·AI 모두 표시한다. 지자체가 나중에 신고된 곳을 청소한다.
alter table public.grades add column if not exists needs_report boolean not null default false;
alter table public.ai_grades add column if not exists needs_report boolean;

-- 7. 등급 기준 v3 (2026-10-02 추가): 덮개를 가린 비율과 주변을 덮은 비율 중 더 심한 쪽으로 매긴다.
--    AI 가 두 비율을 따로 답하므로 따로 저장한다. covered_percent 에는 둘 중 큰 값이 들어간다.
alter table public.ai_grades add column if not exists grate_percent smallint;
alter table public.ai_grades add column if not exists around_percent smallint;
