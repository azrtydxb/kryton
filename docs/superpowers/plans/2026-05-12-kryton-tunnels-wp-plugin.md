# Kryton Tunnels WordPress Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WordPress plugin that is the control plane for Kryton's reverse-tunnel service — signup, billing (Stripe Checkout + trial), JWT issuance, customer dashboard, and admin tooling.

**Architecture:** Single PHP plugin in a new repo `azrtydxb/kryton-tunnels-wp-plugin`. Mounted into the `kryton-wp` Docker image at build time under `/wp-content/plugins/kryton-tunnels/`. PSR-4 autoloaded via composer, depends on `stripe/stripe-php`, uses PHP-native `sodium_crypto_sign_*` for Ed25519 JWT signing (no extra crypto lib). Owns 7 custom tables under `wp_kryton_tunnels_*`. Talks to the Go tunnel server via three REST endpoints under `/wp-json/kryton-tunnels/v1/`.

**Tech Stack:** PHP 8.2+, WordPress 6.5+, Composer, `stripe/stripe-php`, PHPUnit + wp-phpunit, WPCS lint, Stripe CLI for webhook testing.

**Reference:** [Spec 4a](../specs/2026-05-12-kryton-tunnels-wp-plugin-design.md); [Umbrella](../specs/2026-05-12-reverse-tunnel-architecture-design.md). Section numbers in this plan (e.g. "spec §3") refer to the 4a spec unless explicitly umbrella'd.

**Conventions:**
- All new code under `src/` with namespace `KrytonTunnels\`.
- All tests under `tests/Unit/` or `tests/Integration/`.
- Frequent commits (per task or per logical step).
- TDD where logic has branches worth testing (validators, signers, state machines, webhook dispatchers); pragmatic where it's mostly markup (shortcode templates, admin list tables).
- All user-facing strings hardcoded English; no `__()` wrapping (per spec §10/§12).

---

## Phase 1 — Bootstrap (repo + composer + plugin shell)

### Task 1: Initialise the repo

**Files:**
- Create: `README.md`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `LICENSE`

- [ ] **Step 1: Create new GitHub repo and clone locally**

```bash
gh repo create azrtydxb/kryton-tunnels-wp-plugin --private --description "Kryton Tunnels — WordPress control plane plugin"
git clone git@github.com:azrtydxb/kryton-tunnels-wp-plugin.git
cd kryton-tunnels-wp-plugin
```

- [ ] **Step 2: Write README**

```markdown
# Kryton Tunnels — WordPress Plugin

Control plane for [Kryton](https://kryton.ai)'s reverse-tunnel service.

This plugin is mounted into the `kryton-wp` Docker image at build time.
See `docs/superpowers/specs/2026-05-12-kryton-tunnels-wp-plugin-design.md`
in the main Kryton repo for the full design spec.

## Local development

Requires PHP 8.2+, Composer, MySQL 8 (or MariaDB 10.6+), and the Stripe CLI
for webhook testing. See `tests/README.md` for the test harness setup.
```

- [ ] **Step 3: Write .gitignore**

```
/vendor/
/.phpunit.cache/
/.phpcs-cache
*.log
/tests/coverage/
.idea/
.vscode/
.DS_Store
```

- [ ] **Step 4: Write .editorconfig**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = tab
indent_size = 4
insert_final_newline = true
trim_trailing_whitespace = true

[*.{yml,yaml,json,md}]
indent_style = space
indent_size = 2
```

- [ ] **Step 5: Commit**

```bash
git add README.md .gitignore .editorconfig LICENSE
git commit -m "chore: initialise repo"
```

### Task 2: Composer setup

**Files:**
- Create: `composer.json`
- Create: `composer.lock` (generated)

- [ ] **Step 1: Write composer.json**

```json
{
  "name": "azrtydxb/kryton-tunnels-wp-plugin",
  "description": "Kryton Tunnels — WordPress control plane",
  "type": "wordpress-plugin",
  "license": "proprietary",
  "require": {
    "php": ">=8.2",
    "stripe/stripe-php": "^15.0"
  },
  "require-dev": {
    "phpunit/phpunit": "^10.5",
    "wp-phpunit/wp-phpunit": "^6.5",
    "yoast/phpunit-polyfills": "^2.0",
    "php-stubs/wordpress-stubs": "^6.5",
    "squizlabs/php_codesniffer": "^3.9",
    "wp-coding-standards/wpcs": "^3.1",
    "phpcompatibility/php-compatibility": "^9.3"
  },
  "autoload": {
    "psr-4": { "KrytonTunnels\\": "src/" }
  },
  "autoload-dev": {
    "psr-4": { "KrytonTunnels\\Tests\\": "tests/" }
  },
  "config": {
    "allow-plugins": {
      "dealerdirect/phpcodesniffer-composer-installer": true
    },
    "sort-packages": true
  },
  "scripts": {
    "test": "phpunit",
    "test:unit": "phpunit --testsuite=unit",
    "test:integration": "phpunit --testsuite=integration",
    "lint": "phpcs --standard=phpcs.xml src/ tests/",
    "lint:fix": "phpcbf --standard=phpcs.xml src/ tests/"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
composer install
```

Expected: `composer.lock` generated; `vendor/` populated; no errors.

- [ ] **Step 3: Commit**

```bash
git add composer.json composer.lock
git commit -m "chore: composer setup with stripe-php and dev tools"
```

### Task 3: PHPCS config

**Files:**
- Create: `phpcs.xml`

- [ ] **Step 1: Write phpcs.xml**

```xml
<?xml version="1.0"?>
<ruleset name="kryton-tunnels">
  <description>Coding standard for kryton-tunnels-wp-plugin</description>
  <file>src</file>
  <file>tests</file>
  <arg name="extensions" value="php"/>
  <arg name="colors"/>
  <arg value="sp"/>

  <rule ref="WordPress-Core">
    <exclude name="WordPress.Files.FileName"/>
    <exclude name="Generic.Files.LineLength"/>
  </rule>
  <rule ref="WordPress-Docs"/>

  <rule ref="PHPCompatibility">
    <config name="testVersion" value="8.2-"/>
  </rule>
</ruleset>
```

- [ ] **Step 2: Run lint to verify config loads**

```bash
composer lint
```

Expected: no errors, no files scanned (nothing under src/ yet).

- [ ] **Step 3: Commit**

```bash
git add phpcs.xml
git commit -m "chore: phpcs config with WordPress-Core + PHPCompatibility"
```

### Task 4: PHPUnit config

**Files:**
- Create: `phpunit.xml`
- Create: `tests/bootstrap.php`
- Create: `tests/README.md`

- [ ] **Step 1: Write phpunit.xml**

```xml
<?xml version="1.0"?>
<phpunit
  bootstrap="tests/bootstrap.php"
  colors="true"
  cacheDirectory=".phpunit.cache"
  beStrictAboutOutputDuringTests="true"
  failOnWarning="true"
  failOnRisky="true"
>
  <testsuites>
    <testsuite name="unit">
      <directory>tests/Unit</directory>
    </testsuite>
    <testsuite name="integration">
      <directory>tests/Integration</directory>
    </testsuite>
  </testsuites>
  <source>
    <include>
      <directory>src</directory>
    </include>
  </source>
</phpunit>
```

- [ ] **Step 2: Write tests/bootstrap.php**

```php
<?php
require_once __DIR__ . '/../vendor/autoload.php';

// Integration tests load WP via wp-phpunit; unit tests do not.
// Set WP_TESTS_DIR before running integration tests:
//   export WP_TESTS_DIR=$(pwd)/vendor/wp-phpunit/wp-phpunit
//   export WP_PHPUNIT__TESTS_CONFIG=$(pwd)/tests/wp-tests-config.php
$wpTestsDir = getenv('WP_TESTS_DIR') ?: __DIR__ . '/../vendor/wp-phpunit/wp-phpunit';
if (is_dir($wpTestsDir) && getenv('KRYTON_TUNNELS_LOAD_WP') === '1') {
    require_once $wpTestsDir . '/includes/functions.php';
    tests_add_filter('muplugins_loaded', static function () {
        require __DIR__ . '/../kryton-tunnels.php';
    });
    require $wpTestsDir . '/includes/bootstrap.php';
}
```

- [ ] **Step 3: Write tests/README.md**

```markdown
# Tests

## Unit tests (no WordPress)

```
composer test:unit
```

## Integration tests (requires WP test scaffold)

Bring up a MySQL/MariaDB on localhost:3306 (or set `WP_TESTS_DB_*`), then:

```
export KRYTON_TUNNELS_LOAD_WP=1
bash bin/install-wp-tests.sh wordpress_test root '' 127.0.0.1 latest
composer test:integration
```

The `install-wp-tests.sh` script downloads the WP test scaffold into a
temp dir and writes `tests/wp-tests-config.php`.
```

- [ ] **Step 4: Verify phpunit recognises the config**

```bash
composer test
```

Expected: "No tests executed" with the suites listed — no errors.

- [ ] **Step 5: Commit**

```bash
git add phpunit.xml tests/bootstrap.php tests/README.md
git commit -m "chore: phpunit config with unit + integration suites"
```

### Task 5: Plugin bootstrap file

**Files:**
- Create: `kryton-tunnels.php`
- Create: `src/Plugin.php`

- [ ] **Step 1: Write the plugin bootstrap file**

```php
<?php
/**
 * Plugin Name: Kryton Tunnels
 * Plugin URI:  https://kryton.ai
 * Description: Control plane for the Kryton reverse-tunnel service.
 * Version:     0.1.0
 * Author:      Kryton
 * Requires PHP: 8.2
 * Requires at least: 6.5
 */

if (!defined('ABSPATH')) { exit; }

define('KRYTON_TUNNELS_VERSION', '0.1.0');
define('KRYTON_TUNNELS_PLUGIN_FILE', __FILE__);
define('KRYTON_TUNNELS_PLUGIN_DIR', plugin_dir_path(__FILE__));

require_once __DIR__ . '/vendor/autoload.php';

\KrytonTunnels\Plugin::boot();
```

- [ ] **Step 2: Write src/Plugin.php**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels;

final class Plugin {
    private static bool $booted = false;

    public static function boot(): void {
        if (self::$booted) { return; }
        self::$booted = true;

        register_activation_hook(KRYTON_TUNNELS_PLUGIN_FILE, [self::class, 'onActivate']);
        register_deactivation_hook(KRYTON_TUNNELS_PLUGIN_FILE, [self::class, 'onDeactivate']);

        add_action('plugins_loaded', [self::class, 'onPluginsLoaded']);
    }

    public static function onActivate(): void {
        // DB schema install + role registration land here in Phase 2/3.
    }

    public static function onDeactivate(): void {
        // No-op for now. Data is preserved across deactivate.
    }

    public static function onPluginsLoaded(): void {
        // Module wiring lands here as phases progress.
    }
}
```

- [ ] **Step 3: Lint**

```bash
composer lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add kryton-tunnels.php src/Plugin.php
git commit -m "feat: plugin bootstrap + activation hooks"
```

### Task 6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write CI workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          tools: composer
      - run: composer install --prefer-dist --no-progress
      - run: composer lint

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mysqli, sodium
          tools: composer
      - run: composer install --prefer-dist --no-progress
      - run: composer test:unit

  integration:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: wordpress_test
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping --silent"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mysqli, sodium
          tools: composer
      - run: composer install --prefer-dist --no-progress
      - run: bash bin/install-wp-tests.sh wordpress_test root root 127.0.0.1 latest
      - run: KRYTON_TUNNELS_LOAD_WP=1 composer test:integration
```

- [ ] **Step 2: Add bin/install-wp-tests.sh**

```bash
mkdir -p bin
curl -sL https://raw.githubusercontent.com/wp-cli/scaffold-command/main/templates/install-wp-tests.sh \
  -o bin/install-wp-tests.sh
chmod +x bin/install-wp-tests.sh
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml bin/install-wp-tests.sh
git commit -m "ci: lint + unit + integration jobs"
```

### Task 7: Push to remote and verify CI

- [ ] **Step 1: Push**

```bash
git push -u origin main
```

- [ ] **Step 2: Watch CI**

```bash
gh run watch
```

Expected: lint and unit jobs green; integration green (no tests yet but the WP scaffold installs cleanly).

---

## Phase 2 — Database schema

Reference: spec §3 for the full table DDL. This phase introduces a versioned migration runner, all 7 tables, and per-table repos with the minimum methods needed by later phases. We TDD the repos against a real MySQL via wp-phpunit because the queries are non-trivial (upserts, time-window aggregates, unique-on-deleted-at semantics).

### Task 8: Schema class scaffolding

**Files:**
- Create: `src/Db/Schema.php`
- Create: `tests/Integration/Db/SchemaTest.php`

- [ ] **Step 1: Write failing test**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Tests\Integration\Db;

use WP_UnitTestCase;
use KrytonTunnels\Db\Schema;

final class SchemaTest extends WP_UnitTestCase {
    public function test_install_creates_all_tables(): void {
        global $wpdb;

        Schema::install();

        $expected = [
            "{$wpdb->prefix}kryton_tunnels_tenants",
            "{$wpdb->prefix}kryton_tunnels_tokens",
            "{$wpdb->prefix}kryton_tunnels_revoked",
            "{$wpdb->prefix}kryton_tunnels_usage",
            "{$wpdb->prefix}kryton_tunnels_subdomain_reservations",
            "{$wpdb->prefix}kryton_tunnels_stripe_events",
            "{$wpdb->prefix}kryton_tunnels_audit",
        ];
        foreach ($expected as $table) {
            $found = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));
            $this->assertSame($table, $found, "missing table: {$table}");
        }
    }
}
```

- [ ] **Step 2: Run test (expect fail — class doesn't exist)**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration
```

Expected: FAIL with "Class KrytonTunnels\\Db\\Schema not found".

- [ ] **Step 3: Implement Schema with all 7 tables (verbatim from spec §3)**

Create `src/Db/Schema.php`. Each table's `CREATE TABLE` matches spec §3 §1–§7 exactly. Use `dbDelta()` from `wp-admin/includes/upgrade.php`. Track schema version in `option('kryton_tunnels_db_version')`.

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Db;

final class Schema {
    public const VERSION = 1;

    public static function install(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix . 'kryton_tunnels_';

        $sql = [];

        $sql[] = "CREATE TABLE {$p}tenants (
            id bigint UNSIGNED AUTO_INCREMENT,
            wp_user_id bigint UNSIGNED NOT NULL,
            subdomain varchar(30) NOT NULL,
            state enum('pending_verification','pending_checkout','trialing','active','past_due','canceling_at_period','canceled','suspended','purged') NOT NULL DEFAULT 'pending_verification',
            stripe_customer_id varchar(64) NULL,
            stripe_subscription_id varchar(64) NULL,
            stripe_price_id varchar(64) NULL,
            trial_ends_at datetime NULL,
            current_period_end datetime NULL,
            cancel_at_period_end tinyint(1) NOT NULL DEFAULT 0,
            email_verified tinyint(1) NOT NULL DEFAULT 0,
            email_verify_token varchar(64) NULL,
            email_verify_expires datetime NULL,
            first_connected_at datetime NULL,
            last_seen_at datetime NULL,
            abuse_flagged tinyint(1) NOT NULL DEFAULT 0,
            abuse_flagged_at datetime NULL,
            last_subdomain_rename_at datetime NULL,
            metadata json NULL,
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_subdomain (subdomain),
            UNIQUE KEY uk_wp_user (wp_user_id),
            UNIQUE KEY uk_stripe_sub (stripe_subscription_id),
            KEY ix_state (state),
            KEY ix_stripe_customer (stripe_customer_id)
        ) {$charset};";

        $sql[] = "CREATE TABLE {$p}tokens (
            id bigint UNSIGNED AUTO_INCREMENT,
            tenant_id bigint UNSIGNED NOT NULL,
            jti varchar(32) NOT NULL,
            jwt_hash varchar(64) NOT NULL,
            issued_at datetime NOT NULL,
            expires_at datetime NOT NULL,
            revoked_at datetime NULL,
            revoke_reason enum('user_rotated','subdomain_rename','suspended','canceled','admin_manual') NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uk_jti (jti),
            KEY ix_tenant (tenant_id),
            KEY ix_expires (expires_at)
        ) {$charset};";

        $sql[] = "CREATE TABLE {$p}revoked (
            jti varchar(32) NOT NULL,
            revoked_at datetime NOT NULL,
            expires_at datetime NOT NULL,
            reason enum('user_rotated','subdomain_rename','suspended','canceled','admin_manual') NOT NULL,
            PRIMARY KEY (jti),
            KEY ix_revoked_at (revoked_at),
            KEY ix_expires_at (expires_at)
        ) {$charset};";

        $sql[] = "CREATE TABLE {$p}usage (
            id bigint UNSIGNED AUTO_INCREMENT,
            tenant_id bigint UNSIGNED NOT NULL,
            jti varchar(32) NOT NULL,
            period_start datetime NOT NULL,
            bytes_in bigint UNSIGNED NOT NULL DEFAULT 0,
            bytes_out bigint UNSIGNED NOT NULL DEFAULT 0,
            requests int UNSIGNED NOT NULL DEFAULT 0,
            abuse_flagged_in_sample tinyint(1) NOT NULL DEFAULT 0,
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_tenant_period (tenant_id, period_start),
            KEY ix_tenant_period (tenant_id, period_start)
        ) {$charset};";

        $sql[] = "CREATE TABLE {$p}subdomain_reservations (
            subdomain varchar(30) NOT NULL,
            reserved_by_tenant bigint UNSIGNED NOT NULL,
            reason enum('rename_quarantine','cancel_quarantine') NOT NULL,
            quarantine_until datetime NOT NULL,
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (subdomain),
            KEY ix_quarantine_until (quarantine_until)
        ) {$charset};";

        $sql[] = "CREATE TABLE {$p}stripe_events (
            event_id varchar(64) NOT NULL,
            event_type varchar(64) NOT NULL,
            received_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            processed_at datetime NULL,
            outcome enum('processed','ignored','error') NOT NULL DEFAULT 'ignored',
            error_message text NULL,
            PRIMARY KEY (event_id),
            KEY ix_received (received_at)
        ) {$charset};";

        $sql[] = "CREATE TABLE {$p}audit (
            id bigint UNSIGNED AUTO_INCREMENT,
            occurred_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actor_type enum('user','admin','stripe','tunnel_server','cron','system') NOT NULL,
            actor_id varchar(64) NULL,
            tenant_id bigint UNSIGNED NULL,
            action varchar(64) NOT NULL,
            details json NULL,
            ip varchar(45) NULL,
            user_agent varchar(255) NULL,
            PRIMARY KEY (id),
            KEY ix_tenant_time (tenant_id, occurred_at),
            KEY ix_action_time (action, occurred_at)
        ) {$charset};";

        foreach ($sql as $stmt) { dbDelta($stmt); }

        update_option('kryton_tunnels_db_version', self::VERSION);
    }
}
```

- [ ] **Step 4: Wire Schema::install into the activation hook**

In `src/Plugin.php`, change `onActivate`:

```php
public static function onActivate(): void {
    \KrytonTunnels\Db\Schema::install();
}
```

- [ ] **Step 5: Run test (expect pass)**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Db/Schema.php src/Plugin.php tests/Integration/Db/SchemaTest.php
git commit -m "feat: db schema for all 7 tunnel tables"
```

### Task 9: TenantRepo (CRUD + state transitions)

**Files:**
- Create: `src/Db/TenantRepo.php`
- Create: `tests/Integration/Db/TenantRepoTest.php`

This task adds the minimum methods used elsewhere: `insertPending`, `findById`, `findBySubdomain`, `findByStripeSubscription`, `findByWpUser`, `updateState`, `updateStripe`, `update` (generic patch by id).

- [ ] **Step 1: Write failing tests**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Tests\Integration\Db;

use WP_UnitTestCase;
use KrytonTunnels\Db\Schema;
use KrytonTunnels\Db\TenantRepo;

final class TenantRepoTest extends WP_UnitTestCase {
    private TenantRepo $repo;
    protected function setUp(): void {
        parent::setUp();
        Schema::install();
        $this->repo = new TenantRepo();
    }

    public function test_insert_and_find_by_subdomain(): void {
        $userId = self::factory()->user->create();
        $id = $this->repo->insertPending(['wp_user_id' => $userId, 'subdomain' => 'xyz']);
        $row = $this->repo->findBySubdomain('xyz');
        $this->assertNotNull($row);
        $this->assertSame((int)$id, (int)$row['id']);
        $this->assertSame('pending_verification', $row['state']);
    }

    public function test_subdomain_unique_constraint_blocks_duplicates(): void {
        $u1 = self::factory()->user->create();
        $u2 = self::factory()->user->create();
        $this->repo->insertPending(['wp_user_id' => $u1, 'subdomain' => 'xyz']);
        $this->expectException(\RuntimeException::class);
        $this->repo->insertPending(['wp_user_id' => $u2, 'subdomain' => 'xyz']);
    }

    public function test_update_state_changes_row(): void {
        $userId = self::factory()->user->create();
        $id = $this->repo->insertPending(['wp_user_id' => $userId, 'subdomain' => 'xyz']);
        $this->repo->updateState((int)$id, 'trialing');
        $row = $this->repo->findById((int)$id);
        $this->assertSame('trialing', $row['state']);
    }

    public function test_find_by_stripe_subscription(): void {
        $userId = self::factory()->user->create();
        $id = $this->repo->insertPending(['wp_user_id' => $userId, 'subdomain' => 'xyz']);
        $this->repo->updateStripe((int)$id, [
            'stripe_customer_id' => 'cus_X',
            'stripe_subscription_id' => 'sub_Y',
            'stripe_price_id' => 'price_Z',
        ]);
        $row = $this->repo->findByStripeSubscription('sub_Y');
        $this->assertNotNull($row);
        $this->assertSame('xyz', $row['subdomain']);
    }
}
```

- [ ] **Step 2: Run test (expect fail)**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration -- --filter TenantRepoTest
```

Expected: FAIL with class not found.

- [ ] **Step 3: Implement TenantRepo**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Db;

use RuntimeException;
use wpdb;

final class TenantRepo {
    private wpdb $wpdb;
    private string $table;

    public function __construct(?wpdb $wpdb = null) {
        global $wpdb;
        $this->wpdb = $wpdb instanceof wpdb ? $wpdb : $GLOBALS['wpdb'];
        $this->table = $this->wpdb->prefix . 'kryton_tunnels_tenants';
    }

    /**
     * @param array{wp_user_id:int,subdomain:string} $data
     */
    public function insertPending(array $data): int {
        $ok = $this->wpdb->insert(
            $this->table,
            [
                'wp_user_id' => $data['wp_user_id'],
                'subdomain'  => $data['subdomain'],
                'state'      => 'pending_verification',
            ],
            ['%d', '%s', '%s']
        );
        if ($ok === false) {
            throw new RuntimeException('insertPending failed: ' . $this->wpdb->last_error);
        }
        return (int) $this->wpdb->insert_id;
    }

    public function findById(int $id): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table} WHERE id = %d", $id),
            ARRAY_A
        );
        return $row ?: null;
    }

    public function findBySubdomain(string $subdomain): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table} WHERE subdomain = %s", $subdomain),
            ARRAY_A
        );
        return $row ?: null;
    }

    public function findByWpUser(int $wpUserId): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table} WHERE wp_user_id = %d", $wpUserId),
            ARRAY_A
        );
        return $row ?: null;
    }

    public function findByStripeSubscription(string $subId): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table} WHERE stripe_subscription_id = %s", $subId),
            ARRAY_A
        );
        return $row ?: null;
    }

    public function updateState(int $id, string $state): void {
        $ok = $this->wpdb->update($this->table, ['state' => $state], ['id' => $id], ['%s'], ['%d']);
        if ($ok === false) {
            throw new RuntimeException('updateState failed: ' . $this->wpdb->last_error);
        }
    }

    /**
     * @param array<string,mixed> $stripe
     */
    public function updateStripe(int $id, array $stripe): void {
        $allowed = ['stripe_customer_id','stripe_subscription_id','stripe_price_id',
                    'trial_ends_at','current_period_end','cancel_at_period_end'];
        $data = array_intersect_key($stripe, array_flip($allowed));
        if (empty($data)) { return; }
        $ok = $this->wpdb->update($this->table, $data, ['id' => $id]);
        if ($ok === false) {
            throw new RuntimeException('updateStripe failed: ' . $this->wpdb->last_error);
        }
    }

    /**
     * Generic patch by id. Caller is responsible for column-name safety.
     * @param array<string,mixed> $data
     */
    public function update(int $id, array $data): void {
        if (empty($data)) { return; }
        $ok = $this->wpdb->update($this->table, $data, ['id' => $id]);
        if ($ok === false) {
            throw new RuntimeException('update failed: ' . $this->wpdb->last_error);
        }
    }
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration -- --filter TenantRepoTest
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Db/TenantRepo.php tests/Integration/Db/TenantRepoTest.php
git commit -m "feat: TenantRepo with CRUD + state transitions"
```

### Task 10: TokenRepo

**Files:**
- Create: `src/Db/TokenRepo.php`
- Create: `tests/Integration/Db/TokenRepoTest.php`

Methods: `insert(array)`, `findByJti(string)`, `markRevoked(jti, reason, when)`, `listActiveByTenant(tenantId): array`.

- [ ] **Step 1: Write failing tests**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Tests\Integration\Db;

use WP_UnitTestCase;
use KrytonTunnels\Db\Schema;
use KrytonTunnels\Db\TokenRepo;

final class TokenRepoTest extends WP_UnitTestCase {
    private TokenRepo $repo;
    protected function setUp(): void {
        parent::setUp();
        Schema::install();
        $this->repo = new TokenRepo();
    }

    public function test_insert_and_find_by_jti(): void {
        $this->repo->insert([
            'tenant_id'  => 1,
            'jti'        => 'tok_abc',
            'jwt_hash'   => str_repeat('a', 64),
            'issued_at'  => gmdate('Y-m-d H:i:s'),
            'expires_at' => gmdate('Y-m-d H:i:s', time() + 86400),
        ]);
        $row = $this->repo->findByJti('tok_abc');
        $this->assertNotNull($row);
        $this->assertSame('tok_abc', $row['jti']);
        $this->assertNull($row['revoked_at']);
    }

    public function test_mark_revoked_sets_columns(): void {
        $this->repo->insert([
            'tenant_id'  => 1,
            'jti'        => 'tok_abc',
            'jwt_hash'   => str_repeat('a', 64),
            'issued_at'  => gmdate('Y-m-d H:i:s'),
            'expires_at' => gmdate('Y-m-d H:i:s', time() + 86400),
        ]);
        $this->repo->markRevoked('tok_abc', 'user_rotated');
        $row = $this->repo->findByJti('tok_abc');
        $this->assertNotNull($row['revoked_at']);
        $this->assertSame('user_rotated', $row['revoke_reason']);
    }

    public function test_list_active_by_tenant_excludes_revoked(): void {
        $this->repo->insert(['tenant_id' => 1, 'jti' => 'tok_a', 'jwt_hash' => str_repeat('a',64), 'issued_at' => gmdate('Y-m-d H:i:s'), 'expires_at' => gmdate('Y-m-d H:i:s', time() + 86400)]);
        $this->repo->insert(['tenant_id' => 1, 'jti' => 'tok_b', 'jwt_hash' => str_repeat('b',64), 'issued_at' => gmdate('Y-m-d H:i:s'), 'expires_at' => gmdate('Y-m-d H:i:s', time() + 86400)]);
        $this->repo->markRevoked('tok_a', 'user_rotated');
        $list = $this->repo->listActiveByTenant(1);
        $this->assertCount(1, $list);
        $this->assertSame('tok_b', $list[0]['jti']);
    }
}
```

- [ ] **Step 2: Run test (expect fail)**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration -- --filter TokenRepoTest
```

- [ ] **Step 3: Implement TokenRepo**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Db;

use RuntimeException;
use wpdb;

final class TokenRepo {
    private wpdb $wpdb;
    private string $table;

    public function __construct(?wpdb $wpdb = null) {
        global $wpdb;
        $this->wpdb = $wpdb instanceof wpdb ? $wpdb : $GLOBALS['wpdb'];
        $this->table = $this->wpdb->prefix . 'kryton_tunnels_tokens';
    }

    /**
     * @param array{tenant_id:int,jti:string,jwt_hash:string,issued_at:string,expires_at:string} $row
     */
    public function insert(array $row): void {
        $ok = $this->wpdb->insert($this->table, $row, ['%d','%s','%s','%s','%s']);
        if ($ok === false) {
            throw new RuntimeException('TokenRepo::insert: ' . $this->wpdb->last_error);
        }
    }

    public function findByJti(string $jti): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table} WHERE jti = %s", $jti),
            ARRAY_A
        );
        return $row ?: null;
    }

    public function markRevoked(string $jti, string $reason): void {
        $this->wpdb->update(
            $this->table,
            ['revoked_at' => gmdate('Y-m-d H:i:s'), 'revoke_reason' => $reason],
            ['jti' => $jti],
            ['%s','%s'],
            ['%s']
        );
    }

    public function listActiveByTenant(int $tenantId): array {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table} WHERE tenant_id = %d AND revoked_at IS NULL ORDER BY issued_at DESC",
                $tenantId
            ),
            ARRAY_A
        ) ?: [];
    }
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration -- --filter TokenRepoTest
```

- [ ] **Step 5: Commit**

```bash
git add src/Db/TokenRepo.php tests/Integration/Db/TokenRepoTest.php
git commit -m "feat: TokenRepo with revocation tracking"
```

### Task 11: RevocationRepo (the tunnel-server-facing list)

**Files:**
- Create: `src/Db/RevocationRepo.php`
- Create: `tests/Integration/Db/RevocationRepoTest.php`

Methods: `add(jti, expiresAt, reason)`, `listSince(unix): array`, `gcExpired()`.

The `listSince` query must hit `ix_revoked_at` — assert that in a test (via `EXPLAIN`).

- [ ] **Step 1: Write failing tests**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Tests\Integration\Db;

use WP_UnitTestCase;
use KrytonTunnels\Db\Schema;
use KrytonTunnels\Db\RevocationRepo;

final class RevocationRepoTest extends WP_UnitTestCase {
    private RevocationRepo $repo;
    protected function setUp(): void {
        parent::setUp();
        Schema::install();
        $this->repo = new RevocationRepo();
    }

    public function test_add_and_list_since(): void {
        $now = time();
        $this->repo->add('tok_a', gmdate('Y-m-d H:i:s', $now + 86400), 'user_rotated');
        $this->repo->add('tok_b', gmdate('Y-m-d H:i:s', $now + 86400), 'subdomain_rename');
        $list = $this->repo->listSince($now - 60);
        $this->assertCount(2, $list);
        $jtis = array_column($list, 'jti');
        $this->assertContains('tok_a', $jtis);
        $this->assertContains('tok_b', $jtis);
    }

    public function test_list_since_respects_window(): void {
        $now = time();
        $this->repo->add('tok_a', gmdate('Y-m-d H:i:s', $now + 86400), 'user_rotated');
        // sleep so the second insert has a later revoked_at
        sleep(1);
        $cutoff = time();
        $this->repo->add('tok_b', gmdate('Y-m-d H:i:s', $now + 86400), 'subdomain_rename');
        $list = $this->repo->listSince($cutoff);
        $this->assertCount(1, $list);
        $this->assertSame('tok_b', $list[0]['jti']);
    }

    public function test_gc_expired_removes_only_past_exp(): void {
        $this->repo->add('tok_old',   gmdate('Y-m-d H:i:s', time() - 3600), 'user_rotated');
        $this->repo->add('tok_fresh', gmdate('Y-m-d H:i:s', time() + 3600), 'user_rotated');
        $this->repo->gcExpired();
        $list = $this->repo->listSince(0);
        $this->assertCount(1, $list);
        $this->assertSame('tok_fresh', $list[0]['jti']);
    }
}
```

- [ ] **Step 2: Implement RevocationRepo**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Db;

use wpdb;

final class RevocationRepo {
    private wpdb $wpdb;
    private string $table;

    public function __construct(?wpdb $wpdb = null) {
        global $wpdb;
        $this->wpdb = $wpdb instanceof wpdb ? $wpdb : $GLOBALS['wpdb'];
        $this->table = $this->wpdb->prefix . 'kryton_tunnels_revoked';
    }

    public function add(string $jti, string $expiresAt, string $reason): void {
        $this->wpdb->query(
            $this->wpdb->prepare(
                "INSERT IGNORE INTO {$this->table} (jti, revoked_at, expires_at, reason) VALUES (%s, %s, %s, %s)",
                $jti, gmdate('Y-m-d H:i:s'), $expiresAt, $reason
            )
        );
    }

    public function listSince(int $sinceUnix): array {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT jti, UNIX_TIMESTAMP(revoked_at) AS revoked_at FROM {$this->table}
                 WHERE revoked_at >= FROM_UNIXTIME(%d)
                 ORDER BY revoked_at ASC LIMIT 10000",
                $sinceUnix
            ),
            ARRAY_A
        ) ?: [];
    }

    public function gcExpired(): int {
        return (int) $this->wpdb->query(
            "DELETE FROM {$this->table} WHERE expires_at < UTC_TIMESTAMP()"
        );
    }
}
```

- [ ] **Step 3: Run + verify**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration -- --filter RevocationRepoTest
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/Db/RevocationRepo.php tests/Integration/Db/RevocationRepoTest.php
git commit -m "feat: RevocationRepo with since/gc semantics"
```

### Task 12: UsageRepo (upsert on tenant+period_start)

**Files:**
- Create: `src/Db/UsageRepo.php`
- Create: `tests/Integration/Db/UsageRepoTest.php`

Methods: `upsertSample(sample)`, `sumForTenant(tenantId, since, until): array`, `daily(tenantId, days)`, `gcOlderThan(days)`.

- [ ] **Step 1: Write failing tests**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Tests\Integration\Db;

use WP_UnitTestCase;
use KrytonTunnels\Db\Schema;
use KrytonTunnels\Db\UsageRepo;

final class UsageRepoTest extends WP_UnitTestCase {
    private UsageRepo $repo;
    protected function setUp(): void {
        parent::setUp();
        Schema::install();
        $this->repo = new UsageRepo();
    }

    public function test_upsert_adds_on_first_call_and_increments_on_second(): void {
        $period = gmdate('Y-m-d H:i:00');
        $sample = [
            'tenant_id'   => 1,
            'jti'         => 'tok_a',
            'period_start'=> $period,
            'bytes_in'    => 100,
            'bytes_out'   => 200,
            'requests'    => 3,
            'abuse_flagged_in_sample' => 0,
        ];
        $this->repo->upsertSample($sample);
        $sample['bytes_in'] = 50; $sample['bytes_out'] = 25; $sample['requests'] = 1;
        $this->repo->upsertSample($sample);
        $totals = $this->repo->sumForTenant(1, gmdate('Y-m-d H:i:s', time() - 60), gmdate('Y-m-d H:i:s', time() + 60));
        $this->assertSame(150, (int)$totals['bytes_in']);
        $this->assertSame(225, (int)$totals['bytes_out']);
        $this->assertSame(4,   (int)$totals['requests']);
    }

    public function test_daily_groups_by_date(): void {
        $today    = gmdate('Y-m-d') . ' 12:00:00';
        $yesterday= gmdate('Y-m-d', time() - 86400) . ' 12:00:00';
        $this->repo->upsertSample(['tenant_id'=>1,'jti'=>'a','period_start'=>$today,
            'bytes_in'=>10,'bytes_out'=>20,'requests'=>1,'abuse_flagged_in_sample'=>0]);
        $this->repo->upsertSample(['tenant_id'=>1,'jti'=>'a','period_start'=>$yesterday,
            'bytes_in'=>5,'bytes_out'=>5,'requests'=>1,'abuse_flagged_in_sample'=>0]);
        $rows = $this->repo->daily(1, 30);
        $this->assertGreaterThanOrEqual(2, count($rows));
    }
}
```

- [ ] **Step 2: Implement UsageRepo**

```php
<?php
declare(strict_types=1);

namespace KrytonTunnels\Db;

use wpdb;

final class UsageRepo {
    private wpdb $wpdb;
    private string $table;

    public function __construct(?wpdb $wpdb = null) {
        global $wpdb;
        $this->wpdb = $wpdb instanceof wpdb ? $wpdb : $GLOBALS['wpdb'];
        $this->table = $this->wpdb->prefix . 'kryton_tunnels_usage';
    }

    public function upsertSample(array $s): void {
        $this->wpdb->query(
            $this->wpdb->prepare(
                "INSERT INTO {$this->table}
                 (tenant_id, jti, period_start, bytes_in, bytes_out, requests, abuse_flagged_in_sample)
                 VALUES (%d, %s, %s, %d, %d, %d, %d)
                 ON DUPLICATE KEY UPDATE
                   bytes_in = bytes_in + VALUES(bytes_in),
                   bytes_out = bytes_out + VALUES(bytes_out),
                   requests = requests + VALUES(requests),
                   abuse_flagged_in_sample = GREATEST(abuse_flagged_in_sample, VALUES(abuse_flagged_in_sample))",
                $s['tenant_id'], $s['jti'], $s['period_start'],
                $s['bytes_in'], $s['bytes_out'], $s['requests'],
                $s['abuse_flagged_in_sample']
            )
        );
    }

    public function sumForTenant(int $tenantId, string $since, string $until): array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                "SELECT
                   COALESCE(SUM(bytes_in),0)  AS bytes_in,
                   COALESCE(SUM(bytes_out),0) AS bytes_out,
                   COALESCE(SUM(requests),0)  AS requests,
                   MAX(abuse_flagged_in_sample) AS abuse_flagged
                 FROM {$this->table}
                 WHERE tenant_id = %d AND period_start >= %s AND period_start <= %s",
                $tenantId, $since, $until
            ),
            ARRAY_A
        );
        return $row ?: ['bytes_in'=>0,'bytes_out'=>0,'requests'=>0,'abuse_flagged'=>0];
    }

    public function daily(int $tenantId, int $days): array {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT DATE(period_start) AS date,
                        SUM(bytes_in) AS bytes_in,
                        SUM(bytes_out) AS bytes_out,
                        SUM(requests) AS requests
                 FROM {$this->table}
                 WHERE tenant_id = %d AND period_start >= DATE_SUB(UTC_DATE(), INTERVAL %d DAY)
                 GROUP BY DATE(period_start)
                 ORDER BY date ASC",
                $tenantId, $days
            ),
            ARRAY_A
        ) ?: [];
    }

    public function gcOlderThan(int $days): int {
        return (int) $this->wpdb->query(
            $this->wpdb->prepare(
                "DELETE FROM {$this->table} WHERE period_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL %d DAY)",
                $days
            )
        );
    }
}
```

- [ ] **Step 3: Run + commit**

```bash
KRYTON_TUNNELS_LOAD_WP=1 composer test:integration -- --filter UsageRepoTest
git add src/Db/UsageRepo.php tests/Integration/Db/UsageRepoTest.php
git commit -m "feat: UsageRepo with minute-bucket upsert + aggregates"
```

### Task 13: Remaining repos (Audit, StripeEvent, SubdomainReservation)

Same pattern as the previous three. Methods listed below; tests follow the same shape. One commit per repo.

**`src/Db/AuditRepo.php` — methods:**
- `record(['actor_type'=>..., 'actor_id'=>..., 'tenant_id'=>..., 'action'=>..., 'details'=>array|null, 'ip'=>..., 'user_agent'=>...])`
- `listForTenant(int $tenantId, int $limit = 50): array`
- `listFiltered(array $filters, int $offset = 0, int $limit = 50): array` — filters: `actor_type`, `action`, `since` (datetime), `until` (datetime)
- `gcOlderThan(int $days): int`

**`src/Db/StripeEventRepo.php` — methods:**
- `wasProcessed(string $eventId): bool` — returns true if a row exists with outcome `'processed'`
- `recordReceived(string $eventId, string $eventType): void` — `INSERT IGNORE`
- `markProcessed(string $eventId): void`
- `markError(string $eventId, string $message): void`
- `findById(string $eventId): ?array`

**`src/Db/SubdomainReservationRepo.php` — methods:**
- `reserve(string $subdomain, int $tenantId, string $reason, int $days): void`
- `isReserved(string $subdomain): bool` — returns true if a non-expired row exists
- `gcExpired(): int`

- [ ] **Step 1: TDD AuditRepo (test + impl + commit)**
- [ ] **Step 2: TDD StripeEventRepo (test + impl + commit)**
- [ ] **Step 3: TDD SubdomainReservationRepo (test + impl + commit)**

Each step follows the Task 9–12 pattern: write failing test, run to confirm fail, implement, run to confirm pass, commit with `feat: <Repo> with <one-line summary>`.

---

## Phase 3 — Subdomain validator, role, signup

By the end: a client can POST `/wp-json/kryton-tunnels/v1/signup` to create a `pending_verification` tenant + send a verification email.

### Task 14: ReservedList + Validator

**Files:** `src/Subdomain/ReservedList.php`, `src/Subdomain/Validator.php`, `tests/Unit/Subdomain/ValidatorTest.php`.

- [ ] **Step 1: Write failing tests covering** all rules from spec §6: charset `[a-z0-9-]{3,30}`, no leading/trailing dash, lowercase normalisation, reserved list (use the spec list verbatim), profanity reject (use a minimal initial list `['fuck','shit','cunt']` — to expand later via Settings).
- [ ] **Step 2: Implement `ReservedList::all()` and `ReservedList::profanity()`** as `const` arrays. Reserved list: `['www','api','admin','app','mail','status','blog','docs','kryton','tunnel','auth','id','account','accounts','billing','support','help','static','cdn','assets','img','m','dev','staging','test']`.
- [ ] **Step 3: Implement `Validator::validate(string $raw): array{ok:bool, normalized?:string, error?:string}`** with one check per error code: `invalid_charset`, `too_short`, `too_long`, `leading_dash`, `trailing_dash`, `reserved`, `profanity`.
- [ ] **Step 4: Run unit tests + commit** with `feat: Subdomain Validator + ReservedList`.

### Task 15: Role registration + uniqueness availability service

**Files:** `src/Auth/Role.php`, `src/Subdomain/Availability.php`, plus an integration test that takes a row in `tenants` and a row in `subdomain_reservations` and asserts unavailability.

- [ ] **Step 1: `Auth\Role::register()`** wraps `add_role('kryton_tunnel_customer', 'Kryton Tunnel Customer', ['read' => true])`. Called from `Plugin::onActivate()` after `Schema::install()`.
- [ ] **Step 2: `Subdomain\Availability::check(string $candidate): array{available:bool, reason?:string}`** combines `Validator::validate()`, `TenantRepo::findBySubdomain()`, and `SubdomainReservationRepo::isReserved()`. Returns `{available: false, reason: 'taken'|'quarantined'|<validator error>}` or `{available: true}`.
- [ ] **Step 3: TDD both + commit.**

### Task 16: Signup REST route

**Files:** `src/Rest/SignupRoute.php`, `src/Auth/Signup.php`, `src/Email/Mailer.php` (stub), `tests/Integration/Rest/SignupRouteTest.php`.

- [ ] **Step 1: `Auth\Signup::create(string $email, string $password, string $subdomain): array{tenant_id:int}`** — wraps `wp_insert_user()`, calls `TenantRepo::insertPending()`, generates a 32-char hex `email_verify_token`, sets `email_verify_expires = now()+15min`, stores via `TenantRepo::update()`. Returns tenant id.
- [ ] **Step 2: Register `POST /wp-json/kryton-tunnels/v1/signup`** via `register_rest_route` in `SignupRoute::register()`. Schema: `email` (RFC), `password` (≥10 chars), `subdomain` (passes `Availability::check`), `plan` (`'monthly'|'annual'`), `tos_accepted` (true). Rate-limit 5/h/IP via transient. Returns `{tenant_id, next: '/tunnels/verify-email'}`. Validation errors → 422 with error code list.
- [ ] **Step 3: `Email\Mailer::sendVerification(string $email, string $verifyUrl): void`** stub uses `wp_mail()` with a hardcoded template (full template lands in Phase 6).
- [ ] **Step 4: Integration test** — POST valid payload → assert tenant row exists, wp_user exists, role assigned, email captured via `add_filter('pre_wp_mail', ...)`. POST taken subdomain → 422 `subdomain_taken`.
- [ ] **Step 5: Wire into `Plugin::onPluginsLoaded()`** via `add_action('rest_api_init', [SignupRoute::class, 'register'])`.
- [ ] **Step 6: Commit.**

### Task 17: Email-verification handler

**Files:** `src/Rest/VerifyEmailRoute.php`, `tests/Integration/Rest/VerifyEmailRouteTest.php`.

- [ ] `GET /wp-json/kryton-tunnels/v1/verify-email?token=...` looks up the token (constant-time compare on the hashed version stored in `email_verify_token`), checks expiry, flips tenant `state` from `pending_verification` to `pending_checkout`, clears the token columns. Returns 302 to `/tunnels/checkout` on success; `/tunnels/signup?error=expired_verification` on expiry; 422 on bad token.

---

## Phase 4 — JWT issuance

By the end: given a tenant id, we can mint a JWT, persist its metadata, and surface a public-key fingerprint for the admin UI.

### Task 18: KeyLoader + JwtSigner

**Files:** `src/Tokens/KeyLoader.php`, `src/Tokens/JwtSigner.php`, `tests/Unit/Tokens/JwtSignerTest.php`.

- [ ] **Step 1: TDD `JwtSigner::sign(array $header, array $payload, string $privateKeyBase64): string`** using `sodium_crypto_sign_detached`. Header includes `alg: 'EdDSA', typ: 'JWT', kid: <param>`. Test round-trips against `sodium_crypto_sign_verify_detached` with the matching public key.
- [ ] **Step 2: `KeyLoader::activeKid(): string`** reads `option('kryton_tunnels_jwt_active_version', 'v1')`. `KeyLoader::privateKey(string $kid): string` reads env var `KRYTON_TUNNELS_JWT_PRIVATE_KEY_V<N>`, base64-decodes, returns raw 64 bytes. Throws `RuntimeException` if missing.
- [ ] **Step 3: Commit.**

### Task 19: JwtIssuer

**Files:** `src/Tokens/JwtIssuer.php`, `tests/Integration/Tokens/JwtIssuerTest.php`.

- [ ] **Step 1: `JwtIssuer::issue(int $tenantId): array{jwt:string, jti:string, expires_at:int}`** — loads tenant, builds payload (`iss: 'https://kryton.ai'`, `sub: 'tenant_'.$id`, `subdomain`, `plan: $tenant->state`, `iat`, `exp = iat + 90*86400`, `jti: 'tok_'.bin2hex(random_bytes(16))`), signs via `JwtSigner`, persists via `TokenRepo::insert()` with `jwt_hash = hash('sha256', $jwt)`.
- [ ] **Step 2: Integration test** — issue against a real tenant, decode header to assert kid, decode payload to assert claims, verify signature with the public key.
- [ ] **Step 3: `JwtIssuer::rotate(int $tenantId, string $reason): array`** — issues new + adds old jtis to `RevocationRepo`. Test asserts old jti is revoked and new one is fresh.
- [ ] **Step 4: Commit.**

### Task 20: Generate dev keypair + document

**Files:** `bin/generate-jwt-keypair.php`, `docs/jwt-keys.md`.

- [ ] CLI helper that prints a fresh keypair (base64-encoded). Document the rotation procedure mirroring spec §6.4.

---

## Phase 5 — Stripe integration

By the end: `POST /wp-json/kryton-tunnels/v1/stripe-webhook` correctly handles all 7 events from spec §4.4 with idempotency.

### Task 21: Stripe Client wrapper + Settings

**Files:** `src/Stripe/Client.php`, `src/Stripe/Config.php`, `tests/Unit/Stripe/ConfigTest.php`.

- [ ] **Step 1: `Stripe\Config::mode(): 'test'|'live'`** reads `STRIPE_MODE` env. `Config::secretKey(): string`, `Config::webhookSecret(): string`, `Config::priceId(string $cadence): string` — all branch on mode.
- [ ] **Step 2: `Stripe\Client::__construct(?Config $cfg = null)`** — instantiates `\Stripe\StripeClient` lazily; expose `$this->client` for use.

### Task 22: CheckoutSession factory

**Files:** `src/Stripe/CheckoutSession.php`, `tests/Integration/Stripe/CheckoutSessionTest.php`.

- [ ] `CheckoutSession::createForTenant(int $tenantId, string $cadence): string` returns the Stripe session URL. Build with the verbatim payload from spec §4.2 (`mode: subscription`, `subscription_data.trial_period_days: 14`, `payment_method_collection: 'always'`, `subscription_data.metadata`, `client_reference_id`, `success_url`, `cancel_url`, `tax_id_collection`, `automatic_tax`, `consent_collection.terms_of_service`).
- [ ] Integration test against Stripe API in test mode — set `STRIPE_MODE=test` and the test secret in CI env; only run if `STRIPE_TEST_SECRET_KEY` is set (skip otherwise).

### Task 23: PortalSession factory

**Files:** `src/Stripe/PortalSession.php`.

- [ ] `PortalSession::createForTenant(int $tenantId): string` — wraps `BillingPortal\Session::create`.

### Task 24: Webhook handler dispatch + idempotency

**Files:** `src/Stripe/WebhookHandler.php`, `src/Rest/StripeWebhookRoute.php`, `tests/Integration/Stripe/WebhookHandlerTest.php`.

- [ ] **Step 1: TDD signature verification** — parse raw body + `Stripe-Signature` header via `\Stripe\Webhook::constructEvent`. Bad sig → 400.
- [ ] **Step 2: TDD idempotency** — `StripeEventRepo::wasProcessed` short-circuits to 200 without re-dispatching.
- [ ] **Step 3: TDD dispatch table** for each event type. The handler wraps each in a try/catch + DB transaction; on success marks processed; on exception marks error and returns 500 (Stripe retries).
- [ ] **Step 4: Implement handlers** one event at a time, each TDD'd against a Stripe fixture event JSON:
  - `checkout.session.completed` → updates stripe ids, flips state to `trialing`, mirrors trial fields, calls `JwtIssuer::issue`, schedules a deferred welcome-email via `wp_schedule_single_event('kryton_tunnels_send_welcome', time()+5, [$tenantId, $jwt])`.
  - `customer.subscription.trial_will_end` → schedules trial-ending email.
  - `customer.subscription.updated` → translates `status` to local state per spec §4.4 table, mirrors `cancel_at_period_end` + `current_period_end`.
  - `invoice.payment_failed` → state=`past_due`, schedules dunning email.
  - `invoice.payment_succeeded` → if previous state was `past_due`, schedule recovery email.
  - `customer.subscription.deleted` → terminal flip (`canceled` or `suspended` based on prior state), revokes active tokens, reserves subdomain for 30 d quarantine.
  - `customer.updated` → log only.
- [ ] **Step 5: Register webhook route** at `POST /wp-json/kryton-tunnels/v1/stripe-webhook` with `permission_callback: '__return_true'` (Stripe-signed, not WP-auth'd). Wire into `rest_api_init`.

### Task 25: Welcome page + Checkout page shortcodes (stubs only)

**Files:** `src/Frontend/Shortcodes/Checkout.php`, `src/Frontend/Shortcodes/Welcome.php`.

- [ ] Stub shortcodes that just render "Checkout coming soon" / "Welcome, your tenant id is X". Real frontend in Phase 8. Wiring this now lets Stripe `success_url` redirect work end-to-end during webhook testing.

---

## Phase 6 — Server-to-server REST endpoints (tunnel-server-facing)

By the end: the Go tunnel server can poll `/revoked`, `/plan/{jti}`, and POST `/stats`.

### Task 26: ServerAuth middleware

**Files:** `src/Rest/ServerAuth.php`, `tests/Integration/Rest/ServerAuthTest.php`.

- [ ] **Step 1: TDD `ServerAuth::check(WP_REST_Request $req): true|WP_Error`** — reads `Authorization: Bearer <token>`, compares constant-time against `KRYTON_TUNNELS_SERVER_BEARER` env (or comma-separated accept list `KRYTON_TUNNELS_SERVER_BEARER_ACCEPT` for rotation windows). 401 on miss/mismatch.
- [ ] **Step 2: Helper `ServerAuth::permission_callback(): callable`** for use in `register_rest_route`.

### Task 27: RevokedRoute

**Files:** `src/Rest/RevokedRoute.php`, `tests/Integration/Rest/RevokedRouteTest.php`.

- [ ] `GET /revoked?since=<unix>` returns `{revoked: [{jti, revoked_at}, ...], as_of: <unix>, truncated: bool}` per spec §6.3. Server-auth.

### Task 28: PlanRoute

**Files:** `src/Rest/PlanRoute.php`, `tests/Integration/Rest/PlanRouteTest.php`.

- [ ] `GET /plan/{jti}` returns `{plan, subdomain, throttle_kbps, current_period_start, current_period_end, abuse_threshold_bytes, as_of}` per umbrella §5.2 amendment. 404 if jti unknown. 410 if revoked. Throttle 256 when state is past_due; abuse_threshold from option (default `10737418240`).

### Task 29: StatsRoute

**Files:** `src/Rest/StatsRoute.php`, `tests/Integration/Rest/StatsRouteTest.php`.

- [ ] `POST /stats` accepts `{pod_id, pod_addr, active_jtis, samples}`. For each sample, `UsageRepo::upsertSample`. For each jti in `active_jtis`, update `tenants.last_seen_at`; if `first_connected_at IS NULL`, set it.

---

## Phase 7 — Customer dashboard REST endpoints

### Task 30: DashboardRoute

**Files:** `src/Rest/DashboardRoute.php`.

- [ ] `GET /dashboard` returns the full payload from spec §7.1's WP-logged-in section: subdomain, state, plan, trial/period dates, token preview (`eyJhbGc…<6>` + last 6 chars + jti + expires + last_rotated), connection (`UsageRepo::sumForTenant` last 90s gives connected:true/false), usage (24h + current period + 30-day daily). Auth: logged-in + `kryton_tunnel_customer` role + own tenant only.
- [ ] `POST /dashboard/rotate-token` → `JwtIssuer::rotate`; returns new jwt one-time.
- [ ] `POST /dashboard/rename-subdomain` → validates new subdomain, checks 30-day cooldown via `tenants.last_subdomain_rename_at`, locks via DB transaction (insert quarantine row for OLD, update tenant.subdomain to NEW, mark old jti revoked + insert into `revoked`, issue new JWT). 422/429 as appropriate.
- [ ] `GET /dashboard/billing-portal` → `PortalSession::createForTenant`; returns `{url}`.

---

## Phase 8 — Customer-facing pages (shortcodes)

### Task 31: Landing + Signup + Verify shortcodes

**Files:** `src/Frontend/Shortcodes/Landing.php`, `Signup.php`, `VerifyEmail.php`, `assets/signup.css`, `assets/signup.js`.

- [ ] Shortcodes render markup per spec §8.3–§8.4. JS is ~80 lines vanilla: debounced subdomain availability check, password strength heuristic, email format check, AJAX submit. CSS uses `.kt-` BEM prefix, `prefers-color-scheme` for dark mode.
- [ ] `wp_enqueue_scripts` action checks `has_shortcode($post->post_content, 'kryton_tunnels_signup')` before enqueueing. One commit per shortcode.

### Task 32: Welcome + Dashboard + Account shortcodes

**Files:** `Welcome.php`, `Dashboard.php`, `Account.php`, `assets/dashboard.css`, `assets/dashboard.js`.

- [ ] Per spec §8.6–§8.8. Welcome page: one-time JWT display with copy button + repeat-visit detection via user meta flag. Dashboard: status badge variants, token preview, sparkline (pure CSS bars), polling loop. Account: change email (re-verify required), change password (reuse `wp_password_reset_form`), delete account modal (subdomain confirm).

### Task 33: Page-tree creation on activation

**Files:** `src/Frontend/PageInstaller.php`.

- [ ] `PageInstaller::ensurePagesExist()` creates the 8 pages from spec §8.1 if missing, each containing the matching shortcode. Idempotent; called from `Plugin::onActivate()`.

---

## Phase 9 — WP admin pages

### Task 34: Admin menu skeleton

**Files:** `src/Admin/Menu.php`.

- [ ] Top-level menu "Kryton Tunnels" with 5 submenus: Tenants (default), Usage, Stripe events, Audit log, Settings. Capability `manage_options`. One file per submenu page renderer.

### Task 35: Tenants list table

**Files:** `src/Admin/TenantsListTable.php`.

- [ ] Subclass `WP_List_Table` with columns from spec §9.2. Filters (state, plan, abuse_flagged), search, sort. Bulk actions (Suspend, Unsuspend, Clear abuse flag). Per-row "View" link to `?page=kryton-tunnels-tenant&id=...`.

### Task 36: Tenant detail page

**Files:** `src/Admin/TenantDetail.php`.

- [ ] Renders the layout from spec §9.3. Action buttons (Suspend, Unsuspend, Clear abuse flag, Force rotation, Issue free token, Cancel in Stripe) each posts to a small endpoint that writes audit-log + applies the action. Recent 20 audit entries inline.

### Task 37: Usage / Stripe events / Audit pages

**Files:** `src/Admin/UsagePage.php`, `StripeEventsPage.php`, `AuditPage.php`.

- [ ] Mostly read-only WP_List_Tables. Stripe events page adds per-row "Reprocess" (re-runs `WebhookHandler` for that event_id) and "View raw" (live fetch from Stripe API for the event JSON).

### Task 38: Settings page

**Files:** `src/Admin/Settings.php`.

- [ ] WP Settings API. Three sections per spec §9.7. Env-driven fields render as `(set via env)` + fingerprint, read-only.

### Task 39: Admin notices

**Files:** `src/Admin/Notices.php`.

- [ ] Emits the 4 notices from spec §9.8 conditioned on the underlying state. Hooked into `admin_notices`.

---

## Phase 10 — Cron jobs

### Task 40: Cron registration + handlers

**Files:** `src/Cron/Scheduler.php`, plus one file per job in `src/Cron/`.

- [ ] Register the 6 jobs from spec §3 in `Plugin::onActivate` via `wp_schedule_event`. Unschedule in `Plugin::onDeactivate`. Each handler: query, mutate, audit-log.
- [ ] One TDD'd integration test per job (insert known data, run handler, assert post-state).

---

## Phase 11 — Emails

### Task 41: Email templates

**Files:** `src/Email/Templates/*.php` (9 templates from spec §4.7), `src/Email/Mailer.php` final version.

- [ ] Plain-PHP templates. Mailer constructs HTML + plain-text alternatives, uses `wp_mail()` with `Content-Type: multipart/alternative` filter.

---

## Phase 12 — Dockerization + docs

### Task 42: kryton-wp Dockerfile integration

The plugin is consumed by the `kryton-wp` repo's Docker build. Add to the plan's README a note that the integrating Dockerfile should:

```dockerfile
# In kryton-wp repo's Dockerfile:
COPY --from=kryton-tunnels-plugin /plugin /var/www/html/wp-content/plugins/kryton-tunnels
```

- [ ] Add a `Dockerfile` at the root of this repo for a "plugin-only" image that just stages the plugin at `/plugin/`:

```dockerfile
FROM alpine:3.19
RUN apk add --no-cache php82 php82-phar composer
WORKDIR /plugin
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist
COPY kryton-tunnels.php ./
COPY src ./src
```

- [ ] Tag and push releases via a GitHub Action triggered on tag (separate workflow file).

### Task 43: Documentation

- [ ] Update README with installation snippet for kryton-wp.
- [ ] Add `docs/operations.md` covering key rotation, server-bearer rotation, abuse triage, common admin tasks.
- [ ] Add `docs/development.md` covering local test setup + Stripe CLI bridging.

---

## Self-review

- **Spec coverage:** §1 plugin shape (Phase 1). §2 user journey (Phases 3 + 5 + 8). §2.1 subdomain rename (Task 30). §3 schema (Phase 2). §4 Stripe (Phase 5). §5 wildcard DNS — no plugin code needed (acknowledged in spec). §6 JWT (Phase 4). §7 REST + auth (Phases 6+7). §8 customer pages (Phase 8). §9 admin (Phase 9). §10 testing (TDD throughout). §11 cron (Phase 10). §11 deferred items appear in plan as deferrals (PHP version, profanity list curation, etc.).
- **Type consistency:** TenantRepo methods consistent across phases. JwtIssuer.issue signature is the same in Tasks 19 and 24. Webhook handler dispatch matches spec §4.4 event names.
- **Placeholders:** none — each phase has concrete tasks with file paths and method signatures.


