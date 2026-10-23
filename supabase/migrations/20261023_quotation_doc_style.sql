-- Quotes can be issued as an official quote (totals + Terms & Conditions page) or a pricing estimate
-- (per-item pricing only: no totals, no payment-terms footer, no T&C page). Applied live 2026-10-23.
alter table public.quotations add column if not exists doc_style text not null default 'official';
alter table public.quotations drop constraint if exists quotations_doc_style_check;
alter table public.quotations add constraint quotations_doc_style_check check (doc_style in ('official','estimate'));
