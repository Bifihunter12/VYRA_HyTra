// A minimal Supabase stand-in: auth schema, auth.uid(), anon/authenticated roles.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
export async function supabaseLike(files) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
  for (const f of files) await db.exec(fs.readFileSync(f, "utf8"));
  // Run SQL as a given user (or anon when uid is null), like PostgREST does.
  db.as = async (uid, sql, params = []) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); set role ${uid ? "authenticated" : "anon"};`);
    try { return (await db.query(sql, params)).rows; }
    finally { await db.exec("reset role;"); }
  };
  return db;
}
