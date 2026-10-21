-- Sign in with an email or mobile number and a password, with no code sent to confirm the address.
-- The kind of account chosen at sign-up (a business, a CA firm, a lawyer, a freelancer) decides where the person lands.
--
-- Because nothing proves the address belongs to the person who typed it, an account made this way is marked unverified.
-- If the real owner of that address later signs in with a code (which does prove it), the password is removed and every
-- session is ended, so nobody can sit on someone else's address with a password.
alter table app_user
  add column password_hash text check (password_hash is null or length(password_hash) between 20 and 300),
  add column account_type text not null default 'business' check (account_type in ('business', 'ca', 'lawyer', 'freelancer')),
  add column unverified_signup boolean not null default false,
  add column failed_logins int not null default 0,
  add column locked_until timestamptz;
