-- =========================================================
-- 0005: funções internas (gatilhos e auxiliares) não ficam expostas na API
-- (gatilhos não precisam de EXECUTE para disparar; as auxiliares só são
-- chamadas de dentro das funções SECURITY DEFINER)
-- =========================================================
revoke execute on function public.audit_row() from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.stores_guard() from authenticated;
revoke execute on function public.orders_guard() from authenticated;
revoke execute on function public.sync_product_cover() from authenticated;
revoke execute on function public.inherit_product_store() from authenticated;
revoke execute on function public.check_collection_item() from authenticated;
revoke execute on function public.touch_updated_at() from authenticated;
revoke execute on function public.actor_name() from authenticated;
revoke execute on function public.coupon_eval(uuid, text, numeric, text) from authenticated;
revoke execute on function public.delivery_fee_for(public.stores, numeric, numeric, boolean) from authenticated;
revoke execute on function public.biz_error(text, text) from authenticated;
