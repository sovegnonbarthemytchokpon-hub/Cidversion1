-- Step 2 of cumulative subscriptions: allow several active plans per user.
--
-- RUN ONLY AFTER every Supabase Edge Function that reads user_subscriptions
-- reads it as a LIST (no .maybeSingle() on active rows): subscription-access,
-- calcul-*, smart-function, smart-processor, rejected-balls, program-runner,
-- dechiffrement-mt, history-access, result-helf, support-chat,
-- admin-method-control. Otherwise those functions answer 500 for accounts
-- holding two active plans.
--
-- Once this runs, public.purchase_subscription_plan (step 1) automatically
-- stops replacing other plans: each plan keeps its own row, status and
-- expires_at.

begin;

drop index if exists public.user_subscriptions_one_active_plan_idx;
drop index if exists public.user_subscriptions_one_active_idx;

-- Close rows whose own period already ended.
update public.user_subscriptions
set status = 'expired', updated_at = now()
where status = 'active' and expires_at is not null and expires_at <= now();

-- Restore plans that were cancelled only because another plan was bought:
-- most recent still-valid row per (user, plan) with no active row of the
-- same plan. Each keeps its original started_at / expires_at.
with candidates as (
  select distinct on (c.user_id, c.plan_slug) c.id
  from public.user_subscriptions c
  join public.subscription_plans p on p.slug = c.plan_slug and p.enabled = true
  where c.status = 'cancelled'
    and c.plan_slug is not null
    and c.expires_at > now()
    and not exists (
      select 1 from public.user_subscriptions a
      where a.user_id = c.user_id and a.plan_slug = c.plan_slug and a.status = 'active'
    )
  order by c.user_id, c.plan_slug, c.expires_at desc
)
update public.user_subscriptions s
set status = 'active', updated_at = now()
from candidates
where s.id = candidates.id;

create unique index if not exists user_subscriptions_one_active_per_plan_idx
  on public.user_subscriptions (user_id, plan_slug)
  where status = 'active';

create index if not exists user_subscriptions_user_active_idx
  on public.user_subscriptions (user_id, expires_at)
  where status = 'active';

commit;
