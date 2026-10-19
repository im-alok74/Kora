-- Dev and CI only. Production roles are created by the operator (see docs/deploy.md).
create role kora_app nologin;
create role kora_owner login password 'kora_owner_dev' bypassrls;      -- runs migrations, owns functions
create role kora_web login password 'kora_web_dev' in role kora_app;   -- the application connection
alter database kora owner to kora_owner;
