# Kryton Tunnels — WordPress Plugin (Sub-spec 4a)

**Date:** 2026-05-12
**Status:** Approved (design). Plan to follow.
**Umbrella:** [2026-05-12-reverse-tunnel-architecture-design.md](./2026-05-12-reverse-tunnel-architecture-design.md)
**Scope:** The control plane for the reverse tunnel service — signup, billing, JWT issuance, customer dashboard, admin tooling. Sub-spec 4a of 4 (see umbrella §4).

This spec assumes the umbrella's contracts (JWT, REST surface, lifecycle, wire protocol) are settled and refers back to them rather than restating.

## 1. Plugin shape & build

**Repo:** new `azrtydxb/kryton-tunnels-wp-plugin` (PHP).
**Distribution:** plugin source baked into the `kryton-wp` repo's Docker image at build time (git submodule under `wp-content/plugins/kryton-tunnels/` or composer-installed). Plugin lifecycle is "version pinned in the image"; no live install through wp-admin. New plugin version → new `kryton-wp` image → ArgoCD rollout.

**File layout (plugin root):**
```
kryton-tunnels/
  kryton-tunnels.php              # plugin bootstrap (header + autoloader + hooks)
  composer.json                   # stripe/stripe-php, etc.
  src/
    Plugin.php                    # activator, hook wiring, role registration
    Db/
      Schema.php                  # dbDelta for all tables, activation/upgrade
      TenantRepo.php
      TokenRepo.php
      RevocationRepo.php
      UsageRepo.php
      AuditRepo.php
      StripeEventRepo.php
      SubdomainReservationRepo.php
    Stripe/
      Client.php                  # wrapper around stripe/stripe-php
      CheckoutSession.php
      WebhookHandler.php
      PortalSession.php
    Tokens/
      JwtSigner.php               # Ed25519 via sodium_crypto_sign_detached
      JwtIssuer.php               # tenant -> JWT string
      KeyLoader.php               # loads versioned Ed25519 keys from env vars
    Subdomain/
      Validator.php               # charset, length, reserved, profanity
      ReservedList.php
    Auth/
      Role.php                    # registers 'kryton_tunnel_customer' role/caps
      Signup.php                  # creates wp_user + tenant row
    Rest/
      RevokedRoute.php
      PlanRoute.php
      StatsRoute.php
      StripeWebhookRoute.php
      SignupRoute.php
      SubdomainAvailableRoute.php
      VerifyEmailRoute.php
      DashboardRoute.php
      AdminRoutes.php
      ServerAuth.php              # shared-bearer middleware
    Frontend/
      Shortcodes/                 # landing, signup, verify-email, checkout, welcome, dashboard, account
      assets/                     # per-page css + minimal vanilla js
    Admin/
      Menu.php                    # registers the top-level menu
      TenantsListTable.php
      TenantDetail.php
      UsagePage.php
      StripeEventsPage.php
      AuditPage.php
      Settings.php
      Notices.php
    Email/
      Mailer.php                  # wp_mail wrapper
      Templates/
    Cron/
      CleanupAbandonedSignups.php
      GcRevocationList.php
      GcUsageOld.php
      GcSubdomainQuarantine.php
      PurgeCanceledData.php
      ReconcileStripe.php
  tests/
    bootstrap.php
    Unit/...
    Integration/...                # wp-phpunit + WP_UnitTestCase
    E2E/                           # WP-CLI driven flows against docker WP + Stripe CLI
```

**Composer dependencies:**
- `stripe/stripe-php` — official Stripe PHP SDK.
- `guzzlehttp/guzzle` — HTTP for cleaner testability (used only if any future runtime HTTP need arises; not currently required since Cloudflare API is no longer touched at runtime — see §5).
- Dev: `phpunit/phpunit`, `wp-phpunit/wp-phpunit`, `php-stubs/wordpress-stubs`, `squizlabs/php_codesniffer` with WPCS.

**WP and PHP versions:** WordPress 6.5+, PHP 8.2+ (matches `kryton-wp` baseline; to confirm during planning).

**Secrets injected as env vars on the WP Deployment, via external-secrets from OpenBao:**
- `STRIPE_MODE` (`test` or `live`)
- `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`
- `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_WEBHOOK_SECRET`
- `KRYTON_TUNNELS_JWT_PRIVATE_KEY_V1` (base64 Ed25519 secret key)
- `KRYTON_TUNNELS_SERVER_BEARER`
- `KRYTON_TUNNELS_SERVER_BEARER_ACCEPT` (comma-separated, for rotation windows)

No Cloudflare API token in the plugin runtime — see §5.

## 2. User journey

End-to-end happy path:

```
1. LANDING PAGE   /tunnels  ([kryton_tunnels_landing])
2. SIGNUP FORM    /tunnels/signup
   POST /wp-json/kryton-tunnels/v1/signup
   - Validator re-checks subdomain (race-safe via DB unique constraint)
   - Creates wp_user with role 'kryton_tunnel_customer'
   - Sends double-opt-in email (15-min hashed token)
   - Inserts tenant row, state='pending_verification'
3. EMAIL VERIFICATION
   /tunnels/verify?token=...  → validates, flips state='pending_checkout'
4. STRIPE CHECKOUT
   /tunnels/checkout
   - Creates Stripe Checkout Session (see §4)
   - 302 to session.url
5. STRIPE WEBHOOK (checkout.session.completed)
   - Sets stripe_customer_id, stripe_subscription_id
   - state -> 'trialing', trial_ends_at, current_period_end mirrored
   - Issues JWT via JwtIssuer
   - Sends welcome email with one-time token disclosure
6. WELCOME PAGE   /tunnels/welcome?session_id=...
   - Verifies session_id with Stripe directly
   - Displays JWT one-time (also emailed)
   - wp_set_auth_cookie(); redirects to /tunnels/dashboard
7. USER PASTES JWT into Kryton Admin -> Tunnel
   - Kryton dials tunnel.kryton.ai:443, presents JWT
   - Tunnel server reports first stats sample within 60s
   - tenants.first_connected_at set; dashboard shows "Connected"
8. STEADY STATE
   - Stats poster updates wp_kryton_tunnels_usage every minute
   - Trial ends -> Stripe auto-charges -> webhook flips state='active'
```

**Edge cases:**

| Case | Handling |
|---|---|
| User abandons signup at Checkout | Cron `CleanupAbandonedSignups` deletes tenant + wp_user after 24h in `pending_checkout` without `stripe_subscription_id`. |
| Email verification expires | Cron purges `pending_verification` rows after 24h. |
| Trial-end charge declined | `invoice.payment_failed` → `state='past_due'` + throttle flag. Stripe smart retries; on final failure, `subscription.deleted` → `state='suspended'` + revocation. |
| Token leaked | Dashboard "Rotate token" → new JWT issued; old `jti` to revocation list. |
| User cancels mid-trial via Stripe Portal | `subscription.deleted` → `state='canceled'`, JWT revoked, subdomain enters 30-day quarantine. |

### 2.1 Subdomain rename

In v1. Triggered from dashboard "Rename subdomain" button. Rate-limited to 1 per 30 days per tenant via `tenants.last_subdomain_rename_at`.

```
POST /wp-json/kryton-tunnels/v1/dashboard/rename-subdomain
  { new_subdomain }
  - Validator re-checks (charset, reserved, profanity, uniqueness)
  - DB transaction:
      * INSERT subdomain_reservations(OLD, reason='rename_quarantine',
                                      quarantine_until=now()+30d)
      * UPDATE tenants SET subdomain=NEW,
                          last_subdomain_rename_at=now()
      * INSERT revoked(OLD jti, reason='subdomain_rename')
      * Mark old token row revoked_at=now()
      * Issue new JWT via JwtIssuer
  - Send email: "Subdomain renamed; new token attached"
  - Return { new_token, new_subdomain, expires_at }
```

No Cloudflare DNS work (see §5). The new token shows on the rename-success modal and in the email; if both are missed the user can rotate.

## 3. Database schema

All tables prefixed `wp_kryton_tunnels_*`, created via `dbDelta()` in `Db/Schema.php`. Migration version tracked in `option('kryton_tunnels_db_version')`; new migrations are added, never edited.

```sql
-- 1. Tenants
CREATE TABLE wp_kryton_tunnels_tenants (
  id                       bigint UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  wp_user_id               bigint UNSIGNED   NOT NULL,
  subdomain                varchar(30)       NOT NULL,
  state                    enum(
                             'pending_verification','pending_checkout',
                             'trialing','active','past_due',
                             'canceling_at_period','canceled','suspended','purged'
                           ) NOT NULL DEFAULT 'pending_verification',
  stripe_customer_id       varchar(64)       NULL,
  stripe_subscription_id   varchar(64)       NULL,
  stripe_price_id          varchar(64)       NULL,
  trial_ends_at            datetime          NULL,
  current_period_end       datetime          NULL,
  cancel_at_period_end     tinyint(1)        NOT NULL DEFAULT 0,
  email_verified           tinyint(1)        NOT NULL DEFAULT 0,
  email_verify_token       varchar(64)       NULL,
  email_verify_expires     datetime          NULL,
  first_connected_at       datetime          NULL,
  last_seen_at             datetime          NULL,
  abuse_flagged            tinyint(1)        NOT NULL DEFAULT 0,
  abuse_flagged_at         datetime          NULL,
  last_subdomain_rename_at datetime          NULL,
  metadata                 json              NULL,            -- ad-hoc admin flags: free_tier, support_notes, etc.
  created_at               datetime          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               datetime          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                             ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_subdomain (subdomain),
  UNIQUE KEY uk_wp_user (wp_user_id),
  UNIQUE KEY uk_stripe_sub (stripe_subscription_id),
  KEY ix_state (state),
  KEY ix_stripe_customer (stripe_customer_id)
) ENGINE=InnoDB;

-- 2. Tokens
CREATE TABLE wp_kryton_tunnels_tokens (
  id            bigint UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  tenant_id     bigint UNSIGNED   NOT NULL,
  jti           varchar(32)       NOT NULL,
  jwt_hash      varchar(64)       NOT NULL,
  issued_at     datetime          NOT NULL,
  expires_at    datetime          NOT NULL,
  revoked_at    datetime          NULL,
  revoke_reason enum('user_rotated','subdomain_rename','suspended','canceled','admin_manual') NULL,
  UNIQUE KEY uk_jti (jti),
  KEY ix_tenant (tenant_id),
  KEY ix_expires (expires_at)
) ENGINE=InnoDB;

-- 3. Revocation list (append-only; pruned by GC)
CREATE TABLE wp_kryton_tunnels_revoked (
  jti           varchar(32)       PRIMARY KEY,
  revoked_at    datetime          NOT NULL,
  expires_at    datetime          NOT NULL,
  reason        enum('user_rotated','subdomain_rename','suspended','canceled','admin_manual') NOT NULL,
  KEY ix_revoked_at (revoked_at),
  KEY ix_expires_at (expires_at)
) ENGINE=InnoDB;

-- 4. Usage samples (per-minute aggregates from tunnel server)
CREATE TABLE wp_kryton_tunnels_usage (
  id                       bigint UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  tenant_id                bigint UNSIGNED   NOT NULL,
  jti                      varchar(32)       NOT NULL,
  period_start             datetime          NOT NULL,
  bytes_in                 bigint UNSIGNED   NOT NULL DEFAULT 0,
  bytes_out                bigint UNSIGNED   NOT NULL DEFAULT 0,
  requests                 int  UNSIGNED     NOT NULL DEFAULT 0,
  abuse_flagged_in_sample  tinyint(1)        NOT NULL DEFAULT 0,
  created_at               datetime          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_period (tenant_id, period_start),
  KEY ix_tenant_period (tenant_id, period_start)
) ENGINE=InnoDB;

-- 5. Subdomain reservations (quarantine)
CREATE TABLE wp_kryton_tunnels_subdomain_reservations (
  subdomain           varchar(30)       PRIMARY KEY,
  reserved_by_tenant  bigint UNSIGNED   NOT NULL,
  reason              enum('rename_quarantine','cancel_quarantine') NOT NULL,
  quarantine_until    datetime          NOT NULL,
  created_at          datetime          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_quarantine_until (quarantine_until)
) ENGINE=InnoDB;

-- 6. Stripe webhook event log (idempotency)
CREATE TABLE wp_kryton_tunnels_stripe_events (
  event_id      varchar(64)       PRIMARY KEY,
  event_type    varchar(64)       NOT NULL,
  received_at   datetime          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at  datetime          NULL,
  outcome       enum('processed','ignored','error') NOT NULL DEFAULT 'ignored',
  error_message text              NULL,
  KEY ix_received (received_at)
) ENGINE=InnoDB;

-- 7. Audit log
CREATE TABLE wp_kryton_tunnels_audit (
  id          bigint UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  occurred_at datetime          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_type  enum('user','admin','stripe','tunnel_server','cron','system') NOT NULL,
  actor_id    varchar(64)       NULL,
  tenant_id   bigint UNSIGNED   NULL,
  action      varchar(64)       NOT NULL,
  details     json              NULL,
  ip          varchar(45)       NULL,
  user_agent  varchar(255)      NULL,
  KEY ix_tenant_time (tenant_id, occurred_at),
  KEY ix_action_time (action, occurred_at)
) ENGINE=InnoDB;
```

**Cron jobs** (registered via `wp-cron`):

| Job | Schedule | Purpose |
|---|---|---|
| `cleanup_abandoned_signups` | hourly | Delete tenants stuck in `pending_verification` or `pending_checkout` >24h; cascade wp_user. |
| `gc_revocation_list` | daily | Delete `revoked` rows where `expires_at < now()`. |
| `gc_usage_old` | daily | Delete `usage` rows where `period_start < now() - 90d`. |
| `gc_subdomain_quarantine` | daily | Delete `subdomain_reservations` rows where `quarantine_until < now()`. |
| `purge_canceled_data` | daily | Tenants in `canceled`/`suspended` >30d → `purged`; delete token/usage rows; anonymise tenant; optionally delete wp_user. |
| `reconcile_stripe` | daily | Fetch all active subscriptions from Stripe; compare to local tenants; log drift via admin notice. |

**Per-minute usage granularity** is deliberate — request-level data is not needed in WP. The tunnel server batches a minute's worth of samples and POSTs once. Storage is bounded by (active tenants × 1440 rows/day × 90 days).

## 4. Stripe integration

### 4.1 Product / price

One Stripe product `Kryton Tunnel`, two prices (`monthly`, `annual`). Test and live mode each have their own price IDs; stored in WP options `kryton_tunnels_stripe_price_{monthly|annual}_{test|live}`. Configured manually in Stripe Dashboard once.

### 4.2 Checkout Session creation

In `Stripe/CheckoutSession.php`:

```php
$session = \Stripe\Checkout\Session::create([
  'mode' => 'subscription',
  'line_items' => [[ 'price' => $priceId, 'quantity' => 1 ]],
  'subscription_data' => [
    'trial_period_days' => 14,
    'metadata' => [
      'tenant_id' => (string) $tenant->id,
      'subdomain' => $tenant->subdomain,
    ],
    'description' => 'Kryton Tunnel — '.$tenant->subdomain.'.my.kryton.ai',
  ],
  'payment_method_collection' => 'always',
  'customer_email' => $user->user_email,
  'client_reference_id' => (string) $tenant->id,
  'success_url' => home_url('/tunnels/welcome?session_id={CHECKOUT_SESSION_ID}'),
  'cancel_url'  => home_url('/tunnels/checkout?cancelled=1'),
  'allow_promotion_codes' => true,
  'billing_address_collection' => 'auto',
  'tax_id_collection' => ['enabled' => true],
  'automatic_tax' => ['enabled' => true],
  'consent_collection' => ['terms_of_service' => 'required'],
  'expires_at' => time() + 1800,
]);
```

`automatic_tax + tax_id_collection` require Stripe Tax to be enabled in the account; both are toggleable via the Settings page.

### 4.3 Webhook handler

`POST /wp-json/kryton-tunnels/v1/stripe-webhook`. Bypasses normal WP auth.

```
1. Read raw body BEFORE WP touches $_POST.
2. Verify Stripe-Signature with STRIPE_WEBHOOK_SECRET; 400 on bad sig.
3. Dedup against wp_kryton_tunnels_stripe_events.event_id.
   - Already 'processed' -> return 200.
   - Exists with 'error' -> retry.
4. Dispatch by event.type within a DB transaction.
5. On success: outcome='processed', processed_at=now().
6. On exception: outcome='error', error_message; return 500
   (Stripe will retry).
7. Return 200 < 2s. No DNS calls inline (none needed; see §5).
```

### 4.4 Events handled and state transitions

| Stripe event | Action |
|---|---|
| `checkout.session.completed` | Set stripe ids; `state` `pending_checkout` → `trialing`; mirror trial/period; enqueue JWT issuance + welcome email |
| `customer.subscription.trial_will_end` | Send 3-day-out reminder email |
| `customer.subscription.updated` | Translate `status` → `state` (see table below); mirror `cancel_at_period_end`, `current_period_end` |
| `invoice.payment_failed` | `state='past_due'`; throttle flag; send dunning email |
| `invoice.payment_succeeded` | After recovery from past_due: send "back to active" email |
| `customer.subscription.deleted` | If previous state in (`past_due`,`suspended`) → `suspended`; else `canceled`. Revoke active tokens. Insert `subdomain_reservations(reason='cancel_quarantine', until=now()+30d)`. |
| `customer.updated` | Log; v2 will mirror email to wp_user with re-verification |
| `charge.refunded` | Log only; manual admin review |

Stripe `subscription.status` → `tenants.state`:

| Stripe | Our state |
|---|---|
| `trialing` | `trialing` |
| `active` | `active` |
| `past_due` | `past_due` |
| `unpaid` | `past_due` |
| `canceled` | `canceled` or `suspended` (see table above) |
| `incomplete` | should not occur (logged if seen) |
| `incomplete_expired` | `canceled` |

### 4.5 Customer Portal

`Stripe/PortalSession.php` returns a Stripe `BillingPortal\Session::create(...)` URL. Configured (once, in Stripe Dashboard) to allow: cancel-at-period-end, update payment method, view invoices, update billing address / tax ID. Plan switching and quantity changes are disallowed in v1.

### 4.6 Idempotency, retries, reconciliation

- **Event-id dedup** via `stripe_events.event_id` PK.
- **State-machine guards**: out-of-order updates reconcile against `subscription.status` from Stripe, never compute diffs.
- **Daily reconcile cron** fetches all active subscriptions from Stripe; mismatches surface as admin notices (no auto-correction).

### 4.7 Emails

All via `wp_mail()` through `Email/Mailer.php` (transactional only; no unsubscribe links needed under GDPR/CASL for these). Templates:

`verify_email`, `welcome_with_token`, `trial_ending`, `payment_recovered`, `payment_failed`, `subscription_canceled`, `account_suspended`, `subdomain_renamed`, `token_rotated`. English only — no i18n in v1.

### 4.8 Failure modes

- **Stripe down at signup** → form surfaces "Payment provider unavailable, try again". Tenant remains `pending_checkout`; cleanup cron purges if abandoned.
- **Webhook never arrives** (rare; Stripe retries 3 days) → daily reconcile cron applies the correct state; admin notice fires on drift.
- **User lands on `/welcome` before webhook arrives** → page queries Stripe by `session_id`. If tenant still `pending_checkout`, page shows "Almost there… finalising your account" with 5s auto-refresh.

## 5. Cloudflare DNS (and what we don't build)

Wildcard cert implies wildcard DNS. No per-tenant DNS work.

### 5.1 Static records (configured once in Cloudflare, not by plugin)

| Type | Name | Target | TTL | Proxy |
|---|---|---|---|---|
| A | `tunnel.kryton.ai` | DO LB external IP | 60s | DNS-only (gray) |
| CNAME | `*.my.kryton.ai` | `tunnel.kryton.ai` | 60s | DNS-only (gray) |
| CNAME | `my.kryton.ai` | `tunnel.kryton.ai` | 60s | DNS-only (gray) |
| A | `kryton.azrty.com` | DO LB IP | auto | Proxied (orange) |
| A | `kryton.ai` | DO LB IP | auto | Proxied (orange) |

Gray cloud on `*.my.kryton.ai` so Cloudflare doesn't strip headers / interfere with WebSocket upgrades and HTTP/2.

### 5.2 The only Cloudflare API touch — cert-manager DNS-01

A `Certificate` resource in the `kryton-tunnels` namespace, issued by an existing `ClusterIssuer` that uses a Cloudflare API token Secret. Token scoped to `kryton.ai` zone with `Zone:DNS:Edit`. Stored in OpenBao → external-secrets → Kubernetes Secret.

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: my-kryton-ai-wildcard
  namespace: kryton-tunnels
spec:
  secretName: my-kryton-ai-wildcard-tls
  issuerRef:
    name: letsencrypt-cloudflare
    kind: ClusterIssuer
  dnsNames:
    - "my.kryton.ai"
    - "*.my.kryton.ai"
```

This is infrastructure, not WP plugin code. The plugin's runtime has no Cloudflare credentials.

### 5.3 What "owning a subdomain" means

A subdomain `xyz.my.kryton.ai` resolves the moment it's claimed — wildcard CNAME catches everything. Authorization lives at the tunnel server, not in DNS:

- Public request → ingress-nginx → tunnel server.
- Tunnel server looks up `Host: xyz.my.kryton.ai` in its in-memory connection registry.
- If a Kryton instance is connected with a JWT containing `subdomain=xyz`, route there.
- Otherwise return a static "this Kryton is offline" page with `<meta name="robots" content="noindex,nofollow">` and HTTP `410 Gone` (search engines drop the URL).

The DB unique constraint on `tenants.subdomain` + revocation list together ensure at most one valid JWT exists for any subdomain at any time.

## 6. JWT signing & revocation lifecycle

### 6.1 Key management

**Algorithm:** Ed25519 via PHP's native `sodium_crypto_sign_*` (built-in since PHP 7.2 — no library dep).

**Keypair generation:** done once via an ops runbook on a trusted workstation, both halves stored in OpenBao. Private key versioned (`v1`, `v2`, ...) to enable rotation. WP reads the active version from `option('kryton_tunnels_jwt_active_version')`; the tunnel server holds all valid public keys keyed by `kid`.

**WP side:** external-secrets syncs `KRYTON_TUNNELS_JWT_PRIVATE_KEY_V<N>` into env. `KeyLoader.php` parses lazily on first issuance and holds the raw bytes in a module-level static. Keys never touch the WP database.

### 6.2 Issuance

`Tokens/JwtIssuer.php::issue(Tenant $t): array` returns `['jwt' => string, 'jti' => string, 'expires_at' => DateTimeImmutable]`.

```php
public function issue(Tenant $t): array {
    $now = time();
    $jti = 'tok_' . bin2hex(random_bytes(16));
    $payload = [
        'iss'       => 'https://kryton.ai',
        'sub'       => 'tenant_' . $t->id,
        'subdomain' => $t->subdomain,
        'plan'      => $t->state,
        'iat'       => $now,
        'exp'       => $now + 90 * 86400,
        'jti'       => $jti,
    ];
    $header = ['alg' => 'EdDSA', 'typ' => 'JWT', 'kid' => $this->activeKid];
    $signingInput = self::b64u(json_encode($header)) . '.' . self::b64u(json_encode($payload));
    $sig = sodium_crypto_sign_detached($signingInput, $this->privateKey);
    $jwt = $signingInput . '.' . self::b64u($sig);

    $this->tokenRepo->insert([
        'tenant_id'  => $t->id,
        'jti'        => $jti,
        'jwt_hash'   => hash('sha256', $jwt),
        'issued_at'  => gmdate('Y-m-d H:i:s', $now),
        'expires_at' => gmdate('Y-m-d H:i:s', $payload['exp']),
    ]);

    return ['jwt' => $jwt, 'jti' => $jti, 'expires_at' => new DateTimeImmutable("@{$payload['exp']}")];
}
```

`jwt_hash` is for admin diagnostic ("does this token I see in a log belong to this tenant"). The raw JWT is never reconstructed after issuance.

**Plan claim staleness:** the JWT's `plan` claim reflects state at issuance; tunnel server treats it as a hint. The authoritative current plan comes from `GET /plan/{jti}` (cached 5 min). Stale `plan` therefore never affects correctness.

### 6.3 Revocation

A `jti` lands in `wp_kryton_tunnels_revoked` for: user-rotation, subdomain rename, suspension, cancellation, admin manual. `expires_at` mirrors the token's exp; nightly GC removes naturally expired rows.

`GET /wp-json/kryton-tunnels/v1/revoked?since=<unix>` returns:

```json
{
  "as_of": 1747011234,
  "revoked": [
    {"jti": "tok_abc...", "revoked_at": 1747010000},
    {"jti": "tok_def...", "revoked_at": 1747010500}
  ],
  "truncated": false
}
```

`LIMIT 10000` rows; if hit, `truncated: true` and the tunnel server pulls again with the latest `revoked_at`.

**Race window:** worst case "Stripe sends webhook → JWT rejected" ≈ webhook delivery + 30s poll. User-rotate UX surfaces the window: "Your old token may still work for up to 30 seconds."

### 6.4 Public-key rotation

Year-cadence, or immediate on suspected compromise. Procedure summary:

```
Day 0: Generate v2; add v2 priv to OpenBao; add v2 pub to tunnel server ConfigMap.
       Rolling restart tunnel server (now knows v1 + v2 pubkeys).
Day 1: Verify reload.
Day 2: Flip 'active JWT key version' to v2 in WP. New tokens carry kid=v2.
Day 90: All v1 tokens naturally expired. Drop v1 pub from tunnel server,
        delete v1 priv from OpenBao.
```

Emergency variant: skip schedule; flip active immediately and mass-revoke all unrevoked v1 tokens (single SQL insert). Email all customers via auto-generated single-use links to a "show new token" view.

### 6.5 User-facing token UX

- **One-time disclosure** on welcome page after Checkout (also in welcome email). Banner: "Save this token. It will not be shown again."
- **Dashboard preview** truncates to `eyJhbGc…<6 chars>…<last 6 chars>`. Full token never re-rendered.
- **Rotate** button → confirm modal → POST `/dashboard/rotate-token` → one-time display of new token. Old `jti` to revocation list.
- If token + email are both lost but WP login works: rotate to a new one. If WP login is also lost: support contact + email-verified flow forces rotation. (v1: admin handles manually.)

## 7. REST endpoints & auth

### 7.1 Auth modes

| Mode | How |
|---|---|
| Public (rate-limited) | No credentials. Per-IP transient rate limit. |
| Stripe-signed | `Stripe-Signature` header + `STRIPE_WEBHOOK_SECRET`. |
| Tunnel-server bearer | `Authorization: Bearer <shared-secret>`, constant-time compare against env. |
| WP-logged-in | `is_user_logged_in()` + role `kryton_tunnel_customer` or `manage_options`. CSRF via `X-WP-Nonce` for state-changing methods. |

### 7.2 Endpoint table

```
Public (rate-limited)
  POST   /signup
  GET    /subdomain-available?name=xyz
  GET    /verify-email?token=<email_verify_token>     (302 redirect handler)

Stripe-signed
  POST   /stripe-webhook

Tunnel-server bearer
  GET    /revoked?since=<unix>
  GET    /plan/{jti}
  POST   /stats

WP-logged-in (kryton_tunnel_customer)
  GET    /dashboard
  POST   /dashboard/rotate-token
  POST   /dashboard/rename-subdomain
  GET    /dashboard/billing-portal

WP admin (manage_options)
  GET    /admin/tenants?state=&search=&abuse_flagged=
  GET    /admin/tenants/{id}
  POST   /admin/tenants/{id}/suspend
  POST   /admin/tenants/{id}/unsuspend
  POST   /admin/tenants/{id}/issue-free-token
  POST   /admin/tenants/{id}/clear-abuse-flag
  GET    /admin/usage-summary?period=YYYY-MM
```

### 7.3 Rate limits

Per-IP transient-based:

| Endpoint | Limit |
|---|---|
| `POST /signup` | 5 / hour / IP |
| `GET /subdomain-available` | 60 / minute / IP |
| `POST /dashboard/rotate-token` | 5 / hour / user |
| `POST /dashboard/rename-subdomain` | 1 / 30 days / tenant (DB-enforced via `last_subdomain_rename_at`) |

429 responses include `Retry-After`. Cluster-level limits (ingress-nginx annotation) deferred unless abuse appears.

### 7.4 Tunnel-server bearer rotation

Symmetric secret in OpenBao. WP plugin accepts the comma-separated set in `KRYTON_TUNNELS_SERVER_BEARER_ACCEPT` during rotation; tunnel server sends from `KRYTON_TUNNELS_SERVER_BEARER`. Rotation = update both sides → rolling restart → after grace window, narrow ACCEPT list to the new value only.

### 7.5 Audit log

`AuditRepo::record(...)` is called from every state-mutating endpoint, every webhook handler, every cron. Read by the admin Tenant Detail view and the Audit Log page. Pruned to 365 days by daily cron.

### 7.6 CORS

Off by default. All plugin endpoints are server-to-server or same-origin; no `Access-Control-Allow-Origin` headers emitted.

## 8. Customer-facing dashboard pages

All styled with vanilla CSS + minimal vanilla JS (no build step, no React, no jQuery). Pages render inside the active theme's layout. All strings hardcoded English.

### 8.1 Page inventory

| Slug | Shortcode | Auth |
|---|---|---|
| `/tunnels` | `[kryton_tunnels_landing]` | public |
| `/tunnels/signup` | `[kryton_tunnels_signup]` | public |
| `/tunnels/verify-email` | `[kryton_tunnels_verify_email]` | public |
| `/tunnels/verify` | (server-side redirect) | public |
| `/tunnels/checkout` | `[kryton_tunnels_checkout]` | logged-in, `state=pending_checkout` |
| `/tunnels/welcome` | `[kryton_tunnels_welcome]` | logged-in |
| `/tunnels/dashboard` | `[kryton_tunnels_dashboard]` | logged-in |
| `/tunnels/account` | `[kryton_tunnels_account]` | logged-in |

Plugin activation creates the pages if missing. Logged-in users without a tenant on `/dashboard` are redirected to `/signup`; logged-in users with a tenant on `/signup` are redirected to `/dashboard`.

### 8.2 Styling

BEM with `.kt-` prefix to avoid theme collisions. One CSS file per page, enqueued only when `has_shortcode()` matches. Dark mode via `prefers-color-scheme`; no toggle.

### 8.3 Signup page

Fields: email, password (min 10, zxcvbn-like strength ≥3), subdomain (live availability), plan (monthly/annual radio), ToS checkbox. JS does debounced subdomain check, password meter, email-format check. Submit posts JSON to `/signup`.

### 8.4 Email verification interstitial

"Check your inbox" + "Resend verification email" (rate-limited 1/min).

### 8.5 Checkout page

Plan picker + "Continue to Stripe" button → 302 to Stripe Checkout. Trial copy: "First 14 days are free; cancel anytime, no charge."

### 8.6 Welcome page

One-time token disclosure with copy button + "Email me a copy". Banner: "This is the only time we'll show you this token." Setup instructions. Detection of repeat visits (server-side flag + Checkout session expiry) → redirect to dashboard with notice "Your token is no longer visible — rotate if lost."

### 8.7 Main dashboard

Polls `GET /dashboard` (5s default; 1s for first 30s after load; 30s when disconnected). Renders:

- Subdomain + state badge (Connected / Disconnected / Connecting / Past_due / Suspended / Canceling).
- Token preview + "Rotate" button.
- Subdomain row + "Rename" button (live availability check, confirm modal, cooldown displayed).
- Usage last 24h (sparkline + counters: requests, bytes in/out).
- Usage last 30d (daily sparkline + counters).
- Connection status (Kryton version, last seen, instance ID).
- Billing block + "Manage in Stripe" → `GET /dashboard/billing-portal` → window.location.

Sparklines pure CSS `<div>` blocks with computed heights; no chart library.

### 8.8 Account page

Change email (triggers re-verification to new address; swap on click-through). Change password (reuses WP password form). Delete account (modal requires typing subdomain to confirm; cancels Stripe subscription immediately, then standard cancellation chain). Hard delete after 30d.

### 8.9 Accessibility

Visible `:focus-visible` rings. Status badges use color + icon + text. Live regions (`aria-live="polite"`) on state badges. Native `<dialog>` with focus trap. All form fields have `<label>`. WCAG AA contrast in both themes.

## 9. WP admin pages

Available only to `manage_options`. Top-level menu `Kryton Tunnels`.

### 9.1 Menu

```
Kryton Tunnels
├── Tenants            (default)
├── Usage
├── Stripe events
├── Audit log
└── Settings
```

All pages use WP-native admin UI (`WP_List_Table`, Settings API, admin notices). No custom React. Inline JS only for confirms and small interactions.

### 9.2 Tenants list

`WP_List_Table` over `tenants` with filters (state, plan, abuse_flagged, date range), search (email, subdomain, wp_user_id, stripe_customer_id, jti), sort (created_at, last_seen_at, state, subdomain). Bulk actions: Suspend, Unsuspend, Clear abuse flag.

### 9.3 Tenant detail

Per-tenant view: email + wp_user, subdomain + state, Stripe IDs with "Open in Stripe ↗", active token + history, connection (last seen, Kryton version, instance ID), usage this period, abuse flag, action buttons:

- Suspend / Unsuspend
- Clear abuse flag
- Force token rotation
- **Issue free token (bypass Stripe)** — sets `state='active'` + `metadata.free_tier=true`; dashboard hides "Manage billing" for these tenants.
- Cancel subscription in Stripe (proxies to Stripe API).

Recent audit-log entries (last 20) rendered inline; "View all" link.

### 9.4 Usage page

Cluster-wide aggregates by period (`YYYY-MM`): active tenants, signups, cancellations, suspensions; total requests + bytes; top-10 by bandwidth (flag rows over 10 GB); state distribution histogram. CSV export of per-tenant aggregates.

### 9.5 Stripe events page

`WP_List_Table` over `stripe_events` with filters (event_type, outcome, date range). Per-row actions: View raw event (live re-fetch from Stripe), Reprocess (for `error`), Mark ignored.

### 9.6 Audit log page

`WP_List_Table` over `audit` with filters (actor_type, tenant_id, action, date range). Read-only. JSON `details` in collapsible `<details>`. CSV export.

### 9.7 Settings page (WP Settings API)

**Stripe section:**
- Stripe mode (test / live)
- Test/Live secret + webhook secret (env-only, shown as `(set via env)` + fingerprint)
- Test/Live price IDs (monthly, annual)
- Stripe Tax toggle

**Tunnels section:**
- Tunnel server URL (default `tunnel.kryton.ai`, editable for staging)
- Active JWT key version (env-only)
- JWT public key display (for verification)
- Server bearer secret (env-only)
- Bearer accept list (env-only)

**Limits & flags section:**
- Hidden abuse threshold (bytes/period; default 10 GiB)
- Trial days (default 14)
- Subdomain rename cooldown (default 30d)
- Subdomain quarantine (default 30d)
- Reserved subdomains list (extensible)

### 9.8 Notices

Top-of-admin notices, auto-dismissing on condition clear:

- Stripe events failed in last 24h
- Daily reconciliation drift
- JWT key rotation in flight
- Tenants over the hidden abuse threshold

## 10. Testing strategy

- **Unit tests (PHPUnit, no WP):** `Subdomain/Validator`, `Tokens/JwtSigner` + `JwtIssuer` (round-trip with public key verification), state-machine guards in webhook handlers, rate-limit logic.
- **Integration tests (wp-phpunit + WP_UnitTestCase):** REST endpoint contract tests with a real WP DB, all CRUD on the repos, cron jobs with `wp_schedule_event` simulated, dashboard rendering with logged-in fixtures.
- **E2E (WP-CLI + docker compose):** signup → email verify → Stripe Checkout (via Stripe CLI test mode + listen-and-forward) → welcome → dashboard polling → rotate token → rename subdomain → cancel. Run on CI against a fresh WP container.
- **Stripe webhook handler tests:** use Stripe SDK fixtures + Stripe CLI's `stripe trigger <event>` to exercise every event handled in §4.4.
- **No tunnel-server-integration tests in this repo** — those live in 4b and 4c via stubs.

## 11. Open items deferred to plan

- Exact PHP version baseline (confirm `kryton-wp` ships PHP 8.2+).
- Exact zxcvbn-like password-strength heuristic (port a minimal scorer; not the full library).
- ToS / Privacy Policy URLs (out of plugin scope; configured via Settings).
- CSV export format details (column order, header naming).
- Profanity reserved list content (curate during planning).
- Pricing numbers (set in Stripe, mirrored to plugin via price IDs).

## 12. Out of scope (v1, deferred)

- Localisation / i18n (English only; not wrapping strings in `__()`).
- Plan switching between monthly/annual via Stripe Portal (manual cancel + resignup for now).
- BYO custom domains.
- Team accounts (1 WP user = 1 tenant = 1 subdomain).
- Recovery flow for users who lose both token and email access (admin handles manually).
- Re-verification of email-address change (changes are logged in v1; full flow in v2).
- Cluster-level ingress-nginx rate-limit deployment by default.
- Affiliate / referral program.
