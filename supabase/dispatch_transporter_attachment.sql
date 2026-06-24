alter table public.client_dispatch_requests
  add column if not exists transporter_name  text,
  add column if not exists transporter_ci    text,
  add column if not exists transporter_plate text,
  add column if not exists attachment_url    text;
