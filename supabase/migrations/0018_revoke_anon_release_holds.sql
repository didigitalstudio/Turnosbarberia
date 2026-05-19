-- ============================================================================
-- TurnosBarbería — revocar acceso anon a release_expired_holds().
--
-- La migración 0011 había otorgado execute a {authenticated, anon, service_role}.
-- El SECURITY DEFINER de la función hace que cualquier anon visitante pueda
-- forzar el cleanup global de holds — DoS potencial sobre la tabla
-- appointments y race conditions con bookings activos.
--
-- En la app, sólo service_role (server actions) llama a esta función. Si en
-- el futuro hace falta llamarla desde un user logueado, dejamos
-- `authenticated`. anon queda revocado.
-- ============================================================================

revoke execute on function public.release_expired_holds() from anon;
