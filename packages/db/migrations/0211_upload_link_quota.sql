-- A client link can no longer be used to fill the firm's storage. Through one link: at most 10 files per checklist item,
-- 40 files and 50 MB in all for the piece of work. A firm member adding files by hand is not limited by this.
-- Replaces upload_link_add_version from 0206. Safe to run twice.

create or replace function upload_link_add_version(p_hash text, p_request uuid, p_id uuid, p_name text, p_type text, p_size int, p_sha text, p_data bytea, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l upload_link; r document_request; n_item int; n_all int; bytes_all bigint;
begin
  select * into l from upload_link where token_hash = p_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'this link is not valid or has expired' using errcode = 'check_violation'; end if;
  select * into r from document_request where id = p_request and engagement_id = l.engagement_id for update;
  if not found then raise exception 'that item is not part of this request' using errcode = 'check_violation'; end if;
  if r.status in ('accepted', 'waived') then raise exception 'that item is already closed' using errcode = 'check_violation'; end if;
  select count(*) into n_item from document_version where request_id = r.id and uploaded_via = 'link';
  select count(*), coalesce(sum(v.size_bytes), 0) into n_all, bytes_all
    from document_version v join document_request q on q.id = v.request_id where q.engagement_id = l.engagement_id and v.uploaded_via = 'link';
  if n_item >= 10 or n_all >= 40 or bytes_all + p_size > 52428800 then
    raise exception 'upload limit reached for this request' using errcode = 'check_violation';
  end if;
  insert into document_version (id, firm_id, request_id, file_name, content_type, size_bytes, sha256, data, storage_key, uploaded_via)
  values (p_id, l.firm_id, r.id, p_name, p_type, p_size, p_sha, p_data, p_key, 'link');
  update document_request set status = 'received', reason = null, updated_at = now() where id = r.id;
  return p_id;
end $$;
