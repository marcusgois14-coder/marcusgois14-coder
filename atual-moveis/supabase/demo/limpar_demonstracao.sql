-- Remove os pedidos e clientes de DEMONSTRAÇÃO (source = 'demo', telefones com DDD 00).
-- Rode no SQL Editor do Supabase antes de começar a operar de verdade.
begin;
select set_config('atual.rpc', 'on', true);
delete from public.orders where source = 'demo';
delete from public.customers c
 where c.phone like '00999990%'
   and not exists (select 1 from public.orders o where o.customer_id = c.id);
update public.products set sold_count = 0;
commit;
