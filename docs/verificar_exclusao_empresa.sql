-- =============================================================================
-- Verificação de exclusão de empresa
-- Rode ANTES (para ver o que existe) e DEPOIS de apagar pelo painel.
-- Depois da exclusão, todas as linhas devem vir com registros = 0.
-- Só leitura: não altera nada.
-- =============================================================================

-- 1) Todas as tabelas (qualquer schema não interno) com coluna clinic_id
--    ou com FK apontando para public.clinics. Descoberta automática pelo
--    catálogo, então pega também tabelas que a função de exclusão esqueceu.
with alvo as (
  select 'b9609a87-aaca-48ff-b01a-81882ad80902'::uuid as clinic_id
),
colunas as (
  -- colunas chamadas clinic_id
  select c.table_schema::text, c.table_name::text, c.column_name::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.column_name = 'clinic_id'
    and t.table_type = 'BASE TABLE'
    and c.table_schema not in ('pg_catalog', 'information_schema')
  union
  -- colunas com FK para clinics(id), mesmo com outro nome
  select n.nspname::text, r.relname::text, a.attname::text
  from pg_constraint con
  join pg_class r      on r.oid = con.conrelid
  join pg_namespace n  on n.oid = r.relnamespace
  join pg_attribute a  on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
  where con.contype = 'f'
    and con.confrelid = 'public.clinics'::regclass
  union
  -- a própria empresa
  select 'public', 'clinics', 'id'
)
select
  col.table_schema || '.' || col.table_name as tabela,
  col.column_name                           as coluna,
  (xpath('/row/n/text()',
     query_to_xml(format(
       'select count(*) as n from %I.%I where %I = %L',
       col.table_schema, col.table_name, col.column_name, alvo.clinic_id
     ), false, true, '')))[1]::text::bigint as registros
from colunas col, alvo
order by registros desc, tabela;


-- 2) Arquivos no Storage (tudo da empresa fica em whatsapp-media/<clinic_id>/...).
--    Também procura o id em qualquer outro bucket, por segurança.
select bucket_id, count(*) as arquivos, pg_size_pretty(sum((metadata->>'size')::bigint)) as tamanho
from storage.objects
where name like 'b9609a87-aaca-48ff-b01a-81882ad80902/%'
   or name like '%/b9609a87-aaca-48ff-b01a-81882ad80902/%'
group by bucket_id;


-- 3) Contas do Auth. ANTES: lista quem será apagado (só quem não está em outra
--    empresa nem é admin da plataforma). Anote os ids para conferir DEPOIS:
--      select id, email from auth.users where id in ('<id1>', '<id2>', ...);
--    deve voltar vazio.
select u.id, u.email,
       exists (select 1 from public.clinic_users o
               where o.user_id = u.id
                 and o.clinic_id <> 'b9609a87-aaca-48ff-b01a-81882ad80902') as em_outra_empresa,
       exists (select 1 from public.platform_admins pa where pa.user_id = u.id) as admin_plataforma
from public.clinic_users cu
join auth.users u on u.id = cu.user_id
where cu.clinic_id = 'b9609a87-aaca-48ff-b01a-81882ad80902';


-- 4) Instâncias da Evolution que a edge function vai remover (anote antes;
--    depois confira no painel da Evolution que sumiram).
select id, session_name, provider, archived_at
from public.channel_connections
where clinic_id = 'b9609a87-aaca-48ff-b01a-81882ad80902';


-- 5) Tabelas do public SEM clinic_id e sem FK para clinics: não são cobertas
--    pela query 1. Saem por cascata de outra tabela (ex.: conversations) ou
--    não são por empresa. Confira a lista à mão.
select t.table_name
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
  and not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = t.table_name
                    and c.column_name = 'clinic_id')
  and t.table_name <> 'clinics'
order by 1;
