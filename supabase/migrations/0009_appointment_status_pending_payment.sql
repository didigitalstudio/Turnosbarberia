-- Nuevos valores del enum appointment_status para el flow de cobro anticipado.
-- Se separan en migraciones individuales porque Postgres no permite usar un
-- valor de enum nuevo en la misma transacción en la que se agregó.
alter type appointment_status add value if not exists 'pending_payment';
