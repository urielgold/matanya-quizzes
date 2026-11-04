// Tiny helper: run SQL on the project through the Supabase Management API (needs SUPABASE_PAT).
export async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_REF || 'kiccllcmszoedglecbnh'}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SUPABASE_PAT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(r.status + ' ' + t);
  return JSON.parse(t);
}
// Create (or reset) a confirmed email+password user directly in auth.users — for tests only.
export async function ensureUser(email, password) {
  const e = email.replace(/'/g, "''"), p = password.replace(/'/g, "''");
  return sql(`
    do $$ declare v uuid; begin
      select id into v from auth.users where email='${e}';
      if v is null then
        v := gen_random_uuid();
        insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
        values ('00000000-0000-0000-0000-000000000000',v,'authenticated','authenticated','${e}',crypt('${p}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
        insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
        values (gen_random_uuid(),v,v::text,jsonb_build_object('sub',v::text,'email','${e}','email_verified',true),'email',now(),now(),now());
      else
        update auth.users set encrypted_password=crypt('${p}',gen_salt('bf')), email_confirmed_at=coalesce(email_confirmed_at,now()) where id=v;
      end if;
    end $$;`);
}
