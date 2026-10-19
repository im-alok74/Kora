-- Sign-in security: where a session came from, a log of security events, authenticator-app MFA with recovery codes,
-- and a small request limiter that works across servers.

alter table app_session add column ip text, add column user_agent text, add column last_seen_at timestamptz not null default now(), add column mfa boolean not null default false;

create table security_event (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  kind text not null check (length(kind) between 1 and 60),
  ip text,
  user_agent text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on security_event (user_id, created_at desc);

create table user_totp (
  user_id uuid primary key references app_user(id) on delete cascade,
  secret_enc bytea not null,                       -- AES-256-GCM, see totp.ts
  confirmed_at timestamptz,
  last_step bigint not null default 0,             -- the last time step accepted, so one code cannot be used twice
  created_at timestamptz not null default now()
);

create table user_recovery_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  code_hash bytea not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on user_recovery_code (user_id);

-- Between the one-time code and the authenticator code. It holds no session; it only proves the first step was passed.
create table mfa_challenge (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- A request limiter for things that are not tied to a business: sign-in by address, by IP, and so on.
create table rate_event (
  key text not null,
  at timestamptz not null default now()
);
create index on rate_event (key, at desc);

grant select, insert on security_event to kora_app;
grant select, insert, update, delete on user_totp, user_recovery_code to kora_app;
grant select, insert, update on mfa_challenge to kora_app;
grant select, insert, delete on rate_event to kora_app;
