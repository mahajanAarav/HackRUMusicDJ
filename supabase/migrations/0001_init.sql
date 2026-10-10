-- Schema for the Supabase-backed Store (the demo currently uses MemoryStore behind the same interface).
-- Only vitals READINGS are stored; there is no column or bucket for video.
create table rooms (
  code text primary key,
  mode text not null check (mode in ('hype','winddown')),
  vitals_source text not null default 'simulated' check (vitals_source in ('simulated','live')),
  pulse_check jsonb,
  created_at timestamptz not null default now()
);

create table guests (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(code) on delete cascade,
  name text not null,
  sensing boolean not null default false,   -- explicit opt-in
  simulated boolean not null default false,
  joined_at timestamptz not null default now()
);

create table inputs (
  id text primary key,
  room_code text not null references rooms(code) on delete cascade,
  guest_id uuid not null references guests(id) on delete cascade,
  guest_name text not null,
  kind text not null check (kind in ('text','photo','voice')),
  text text,
  mime text,
  storage_path text,                          -- Supabase Storage object for photo/voice
  created_at timestamptz not null default now()
);

create table readings (
  id bigint generated always as identity primary key,
  room_code text not null references rooms(code) on delete cascade,
  guest_id uuid not null references guests(id) on delete cascade,
  ts timestamptz not null,
  pulse_bpm real, breathing_rpm real, valence real, expression_label text,
  confidence real not null,
  source text not null check (source in ('presage','simulated'))
);
create index readings_room_ts on readings(room_code, ts desc);

create table queue (
  id text primary key,
  room_code text not null references rooms(code) on delete cascade,
  status text not null default 'queued' check (status in ('queued','playing','played','skipped')),
  mode text not null,
  item jsonb not null,                        -- QueueItemDraft (song, artist, video_id, reason, influenced_by, physiological_evidence, announcement, energy)
  baseline jsonb,
  added_at timestamptz not null default now(),
  started_at timestamptz, ended_at timestamptz
);

create table impacts (
  queue_id text primary key references queue(id) on delete cascade,
  room_code text not null references rooms(code) on delete cascade,
  impact jsonb not null
);

create table trace (
  id text primary key,
  room_code text not null references rooms(code) on delete cascade,
  ts timestamptz not null default now(),
  event jsonb not null
);

alter publication supabase_realtime add table queue, trace, readings;
