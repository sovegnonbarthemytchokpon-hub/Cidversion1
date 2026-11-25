-- Cumulative subscriptions (general003, premium001, vip002…).
--
-- Activating a plan never cancels the account's other plans. Each plan keeps
-- its own row, status and expires_at, and only expires when its own
-- expires_at has passed. Buying a plan that is already active prolongs that
-- plan's own period without a gap.
--
-- Transitional guard: while the legacy "one active subscription per user"
-- unique indexes still exist (see 20261125120100_*), a second active row
-- cannot be inserted, so the function keeps the legacy replacement for that
-- case instead of failing. Once those indexes are dropped the function is
-- fully cumulative with no further change.

create or replace function public.purchase_subscription_plan(
  target_user_id uuid,
  target_plan_slug text,
  target_duration_months integer default 1,
  target_renewal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  plan_record public.subscription_plans%rowtype;
  current_stars integer := 0;
  current_tokens integer := 0;
  next_stars integer := 0;
  next_tokens integer := 0;
  subscription_id uuid;
  referrer_id uuid;
  referral_event_id uuid;
  selected_months integer := coalesce(target_duration_months, 1);
  selected_days integer;
  selected_cost integer;
  selected_option jsonb;
  same_plan_id uuid;
  same_plan_expires_at timestamptz;
  final_expires_at timestamptz;
  extended boolean := false;
  legacy_single_plan boolean := false;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Accès serveur requis';
  end if;

  if target_user_id is null
     or nullif(btrim(target_plan_slug), '') is null then
    raise exception 'Niveau de déblocage invalide';
  end if;

  -- Serialise purchases of one account.
  perform pg_advisory_xact_lock(hashtextextended('purchase_subscription:' || target_user_id::text, 0));

  select * into plan_record
  from public.subscription_plans
  where slug = lower(btrim(target_plan_slug)) and enabled = true;
  if not found then
    raise exception 'Niveau introuvable';
  end if;

  if selected_months < 1 or selected_months > 120 then
    raise exception 'Durée de déblocage invalide';
  end if;

  selected_days := plan_record.duration_days;
  selected_cost := case
    when plan_record.unlock_currency = 'tokens' then plan_record.required_tokens
    else plan_record.required_stars
  end;

  -- Each plan expires on its own expires_at only.
  update public.user_subscriptions
  set status = 'expired', updated_at = now()
  where user_id = target_user_id
    and status = 'active'
    and expires_at is not null
    and expires_at <= now();

  -- Only the row of THIS plan is ever touched; other plans stay active.
  select id, expires_at
  into same_plan_id, same_plan_expires_at
  from public.user_subscriptions
  where user_id = target_user_id
    and plan_slug = plan_record.slug
    and status = 'active'
  order by expires_at desc nulls first
  limit 1
  for update;

  if target_renewal then
    if same_plan_id is null then
      raise exception 'RENEWAL_UNAVAILABLE';
    end if;
    select value into selected_option
    from jsonb_array_elements(coalesce(plan_record.renewal_options, '[]'::jsonb)) as option(value)
    where (value->>'months')::integer = selected_months
    limit 1;
    if selected_option is null then
      raise exception 'RENEWAL_UNAVAILABLE';
    end if;
  elsif jsonb_array_length(coalesce(plan_record.duration_options, '[]'::jsonb)) > 0 then
    select value into selected_option
    from jsonb_array_elements(plan_record.duration_options) as option(value)
    where (value->>'months')::integer = selected_months
    limit 1;
    if selected_option is null and selected_months <> 1 then
      raise exception 'Durée de déblocage indisponible pour cette offre';
    end if;
  end if;

  if selected_option is not null then
    selected_days := coalesce(nullif(selected_option->>'duration_days', '')::integer, selected_months * 30);
    selected_cost := coalesce(
      nullif(selected_option->>'cost', '')::integer,
      case
        when plan_record.unlock_currency = 'tokens' then nullif(selected_option->>'required_tokens', '')::integer
        else nullif(selected_option->>'required_stars', '')::integer
      end,
      0
    );
  elsif not target_renewal and selected_months <> 1 then
    raise exception 'Cette offre ne propose pas cette durée';
  end if;

  if selected_days < 1 or selected_days > 3650 or selected_cost < 0 or selected_cost > 1000000 then
    raise exception 'Tarif ou durée de déblocage invalide';
  end if;

  select coalesce(stars, 0), coalesce(tokens, 0)
  into current_stars, current_tokens
  from public.user_metrics
  where user_id = target_user_id
  for update;

  if plan_record.unlock_currency = 'tokens' then
    if current_tokens < selected_cost then
      raise exception 'INSUFFICIENT_TOKENS:%:%', current_tokens, selected_cost;
    end if;
    next_tokens := current_tokens - selected_cost;
    next_stars := current_stars;
  else
    if current_stars < selected_cost then
      raise exception 'INSUFFICIENT_STARS:%:%', current_stars, selected_cost;
    end if;
    next_stars := current_stars - selected_cost;
    next_tokens := current_tokens;
  end if;

  insert into public.user_metrics (user_id, stars, tokens, share_count, updated_at)
  values (target_user_id, next_stars, next_tokens, 0, now())
  on conflict (user_id) do update
    set stars = excluded.stars, tokens = excluded.tokens, updated_at = now();

  if same_plan_id is not null then
    -- Same plan already active: prolong its own period without a gap.
    extended := true;
    update public.user_subscriptions
    set expires_at = case
          when expires_at is null then null
          else greatest(expires_at, now()) + make_interval(days => selected_days)
        end,
        updated_at = now()
    where id = same_plan_id
    returning id, expires_at into subscription_id, final_expires_at;
  else
    legacy_single_plan := exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname in ('user_subscriptions_one_active_idx', 'user_subscriptions_one_active_plan_idx')
    );
    if legacy_single_plan then
      -- Transitional only (legacy unique index still present).
      update public.user_subscriptions
      set status = 'cancelled', updated_at = now()
      where user_id = target_user_id and status = 'active';
    end if;
    insert into public.user_subscriptions (user_id, plan_slug, status, started_at, expires_at, updated_at)
    values (target_user_id, plan_record.slug, 'active', now(), now() + make_interval(days => selected_days), now())
    returning id, expires_at into subscription_id, final_expires_at;
  end if;

  if plan_record.unlock_currency = 'tokens' and selected_cost > 0 then
    insert into public.token_spends (user_id, amount, plan_slug, plan_name)
    values (target_user_id, selected_cost, plan_record.slug, plan_record.display_name);
  elsif plan_record.unlock_currency = 'stars' and selected_cost > 0 then
    insert into public.star_spends (user_id, amount, plan_slug, plan_name)
    values (target_user_id, selected_cost, plan_record.slug, plan_record.display_name);
  end if;

  insert into public.notifications (user_id, type, title, message)
  values (
    target_user_id,
    'REWARD',
    'Abonnement débloqué',
    format(
      '%s %s pour %s mois. Il vous reste %s étoile(s) et %s jeton(s).',
      plan_record.display_name,
      case when extended then 'est prolongé sans coupure' else 'est actif' end,
      selected_months,
      next_stars,
      next_tokens
    )
  );

  if plan_record.referral_reward_stars > 0 then
    select parent.user_id into referrer_id
    from public.referral_accounts child
    join public.referral_accounts parent on parent.referral_code = child.referred_by
    where child.user_id = target_user_id;

    if referrer_id is not null and referrer_id <> target_user_id then
      insert into public.referral_events (user_id, event_key, event_type, referrer_user_id)
      values (target_user_id, 'purchase:' || subscription_id, 'purchase', referrer_id)
      on conflict (event_key) do nothing
      returning id into referral_event_id;

      if referral_event_id is not null then
        perform public.admin_grant_user_stars_with_audit(
          referrer_id,
          plan_record.referral_reward_stars,
          'adjustment',
          format('Récompense de parrainage pour l’achat du niveau %s.', plan_record.display_name),
          target_user_id
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'subscriptionId', subscription_id,
    'planSlug', plan_record.slug,
    'displayName', plan_record.display_name,
    'durationDays', selected_days,
    'durationMonths', selected_months,
    'renewal', target_renewal,
    'extended', extended,
    'expiresAt', final_expires_at,
    'cumulative', not legacy_single_plan,
    'unlockCurrency', plan_record.unlock_currency,
    'spentStars', case when plan_record.unlock_currency = 'stars' then selected_cost else 0 end,
    'spentTokens', case when plan_record.unlock_currency = 'tokens' then selected_cost else 0 end,
    'remainingStars', next_stars,
    'remainingTokens', next_tokens
  );
end;
$function$;
