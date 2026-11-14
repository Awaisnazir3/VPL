#!/usr/bin/php
<?php
/**
 * ============================================================================
 * SipMyNumber ? Outbound WebRTC Call Router & Real-Time Talktime Guard
 * Server: 192.168.88.51 (Core SIP Server)
 * Database: 192.168.88.119 (MySQL vpl_crm)
 * Trunk: VPL-OUTBOUND (192.168.88.88)
 * ============================================================================
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');

$CONFIG = [
    'db' => [
        'host'     => '192.168.88.119',
        'port'     => 3306,
        'dbname'   => 'vpl_crm',
        'username' => 'kamailio',
        'password' => 'Kamailio@2026!Secure',
        'charset'  => 'utf8mb4'
    ],
    'telephony' => [
        'outbound_trunk' => 'VPL-OUTBOUND',
        'default_rate'   => 0.0500,
    ]
];

class AsteriskAGI {
    private $in;
    private $out;
    public $is_agi = false;
    public $agi_vars = [];

    public function __construct() {
        $this->in = defined('STDIN') ? STDIN : fopen('php://stdin', 'r');
        $this->out = defined('STDOUT') ? STDOUT : fopen('php://stdout', 'w');

        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            $this->is_agi = false;
            return;
        }

        if (function_exists('posix_isatty') && posix_isatty($this->in)) {
            $this->is_agi = false;
            return;
        }

        if (isset($_SERVER['AGI_REQUEST']) || isset($_ENV['AGI_REQUEST'])) {
            $this->is_agi = true;
            $this->read_environment();
            return;
        }

        $read = [$this->in];
        $write = null;
        $except = null;
        if (@stream_select($read, $write, $except, 0, 100000) > 0) {
            $test = @fgets($this->in, 1024);
            if ($test && (strpos($test, 'agi_') === 0)) {
                $this->is_agi = true;
                $this->parse_line($test);
                $this->read_environment();
                return;
            }
        }

        $this->is_agi = false;
    }

    private function parse_line($line) {
        $parts = explode(':', trim($line), 2);
        if (count($parts) === 2) {
            $this->agi_vars[trim($parts[0])] = trim($parts[1]);
        }
    }

    private function read_environment() {
        while (($line = fgets($this->in, 1024)) !== false) {
            $line = trim($line);
            if ($line === '') break;
            $this->parse_line($line);
        }
    }

    public function command($cmd) {
        if (!$this->is_agi) return null;
        fputs($this->out, trim($cmd) . "\n");
        fflush($this->out);
        $result = fgets($this->in, 4096);
        return trim($result);
    }

    public function verbose($msg, $level = 2) {
        if ($this->is_agi) {
            $this->command("VERBOSE \"" . addslashes($msg) . "\" $level");
        } else {
            echo "[VERBOSE] $msg\n";
        }
    }

    public function execute($app, $args = '') {
        if ($this->is_agi) {
            return $this->command("EXEC $app \"$args\"");
        }
        return null;
    }

    public function get_variable($name) {
        if ($this->is_agi) {
            $resp = $this->command("GET VARIABLE $name");
            if (preg_match('/\((.*)\)/', $resp, $matches)) {
                return $matches[1];
            }
        }
        return null;
    }

    public function hangup() {
        if ($this->is_agi) {
            $this->command("HANGUP");
        }
    }
}

function getDbConnection($config) {
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $config['host'],
        $config['port'],
        $config['dbname'],
        $config['charset']
    );
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 3,
    ];
    return new PDO($dsn, $config['username'], $config['password'], $options);
}

function logCdr($pdo, $userId, $caller, $callee, $duration, $disposition, $cost) {
    try {
        $stmt = $pdo->prepare("
            INSERT INTO cdrs (user_id, caller, callee, duration, disposition, cost, created_at)
            VALUES (:user_id, :caller, :callee, :duration, :disposition, :cost, NOW())
        ");
        $stmt->execute([
            ':user_id'     => $userId,
            ':caller'      => substr($caller, 0, 50),
            ':callee'      => substr($callee, 0, 50),
            ':duration'    => (int)$duration,
            ':disposition' => substr($disposition, 0, 30),
            ':cost'        => (float)$cost
        ]);
        return $pdo->lastInsertId();
    } catch (Exception $e) {
        error_log("[CDR ERROR] Failed to insert CDR: " . $e->getMessage());
        return null;
    }
}

function deductBalance($pdo, $userId, $amount) {
    try {
        $stmt = $pdo->prepare("
            UPDATE users 
            SET balance = GREATEST(0.00, balance - :amount) 
            WHERE id = :id
        ");
        $stmt->execute([
            ':amount' => (float)$amount,
            ':id'     => (int)$userId
        ]);
        return true;
    } catch (Exception $e) {
        error_log("[BILLING ERROR] Failed to deduct balance: " . $e->getMessage());
        return false;
    }
}

$agi = new AsteriskAGI();

$rawDest = '';
if (!empty($argv[1])) {
    $rawDest = $argv[1];
} elseif ($agi->is_agi && isset($agi->agi_vars['agi_extension'])) {
    $rawDest = $agi->agi_vars['agi_extension'];
}

$rawCaller = '';
if (!empty($argv[2])) {
    $rawCaller = $argv[2];
} elseif ($agi->is_agi && isset($agi->agi_vars['agi_callerid'])) {
    $rawCaller = $agi->agi_vars['agi_callerid'];
}

$callerExt = preg_replace('/[^0-9]/', '', $rawCaller);

$agi->verbose("===> [SipMyNumber Outbound] Caller Ext: {$callerExt} | Dialed Target: {$rawDest} <===");

if (empty($callerExt) || empty($rawDest)) {
    $agi->verbose("[OUTBOUND ERROR] Missing caller extension or destination target!", 1);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'cannot-complete-as-dialed');
        $agi->hangup();
    }
    exit(1);
}

try {
    $pdo = getDbConnection($CONFIG['db']);
} catch (Exception $e) {
    $agi->verbose("[OUTBOUND FATAL] Database connection failed: " . $e->getMessage(), 1);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'all-circuits-busy-now');
        $agi->hangup();
    }
    exit(1);
}

$stmt = $pdo->prepare("
    SELECT 
        u.id AS user_id,
        u.name AS user_name,
        u.email AS user_email,
        u.balance AS user_balance,
        s.order_id,
        s.status AS sip_status
    FROM sip_accounts s
    JOIN users u ON u.id = s.user_id
    WHERE s.order_id = :ext
    LIMIT 1
");
$stmt->execute([':ext' => $callerExt]);
$user = $stmt->fetch();

if (!$user) {
    $agi->verbose("[OUTBOUND REJECT] Extension {$callerExt} not found in database!");
    logCdr($pdo, null, $callerExt, $rawDest, 0, 'FAILED_EXTENSION_NOT_FOUND', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'cannot-complete-as-dialed');
        $agi->hangup();
    }
    exit(1);
}

if ($user['sip_status'] === 'suspended') {
    $agi->verbose("[OUTBOUND REJECT] Extension {$callerExt} ({$user['user_name']}) is suspended!");
    logCdr($pdo, $user['user_id'], $callerExt, $rawDest, 0, 'FAILED_ACCOUNT_SUSPENDED', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'ss-noservice');
        $agi->hangup();
    }
    exit(2);
}

$userBal = (float)$user['user_balance'];
if ($userBal <= 0.00) {
    $agi->verbose(sprintf("[OUTBOUND REJECT] Extension %s (%s) has zero or negative balance ($%.2f)!", 
        $callerExt, $user['user_name'], $userBal));
    logCdr($pdo, $user['user_id'], $callerExt, $rawDest, 0, 'REJECTED_ZERO_BALANCE', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Answer');
        $agi->execute('Wait', '1');
        $agi->execute('Playback', 'im-sorry');
        $agi->execute('Playback', 'ss-noservice');
        $agi->hangup();
    }
    exit(3);
}

$cleanDest = preg_replace('/[^0-9]/', '', $rawDest);
if (str_starts_with($cleanDest, '00')) {
    $cleanDest = substr($cleanDest, 2);
}

$rateStmt = $pdo->prepare("SELECT id, country_name, country_code, rate_per_minute FROM destination_rates WHERE is_active = 1");
$rateStmt->execute();
$allRates = $rateStmt->fetchAll();

$longestMatch = -1;
$matchedRate = null;
foreach ($allRates as $r) {
    $code = trim($r['country_code']);
    if (str_starts_with($cleanDest, $code) && strlen($code) > $longestMatch) {
        $longestMatch = strlen($code);
        $matchedRate = $r;
    }
}

if (!$matchedRate) {
    $matchedRate = [
        'country_name'    => 'Standard International',
        'country_code'    => 'Default',
        'rate_per_minute' => $CONFIG['telephony']['default_rate']
    ];
}

$ratePerMin = (float)$matchedRate['rate_per_minute'];
if ($ratePerMin <= 0) $ratePerMin = 0.0150;

$maxSeconds = floor(($userBal / $ratePerMin) * 60);

$agi->verbose(sprintf(
    "[TALKTIME GUARD] Ext: %s (%s) | Balance: $%.2f | Dest: %s (%s, +%s) | Rate: $%.4f/min | Allowed Talktime: %d secs (~%.1f mins)",
    $callerExt,
    $user['user_name'],
    $userBal,
    $rawDest,
    $matchedRate['country_name'],
    $matchedRate['country_code'],
    $ratePerMin,
    $maxSeconds,
    $maxSeconds / 60
));

if ($userBal < $ratePerMin || $maxSeconds < 60) {
    $agi->verbose(sprintf("[TALKTIME GUARD] Call BLOCKED: Balance $%.2f is less than 1 min rate ($%.4f) for %s!",
        $userBal, $ratePerMin, $matchedRate['country_name']));
    logCdr($pdo, $user['user_id'], $callerExt, $rawDest, 0, 'FAILED_INSUFFICIENT_TALKTIME', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Answer');
        $agi->execute('Wait', '1');
        $agi->execute('Playback', 'im-sorry');
        $agi->execute('Playback', 'ss-noservice');
        $agi->hangup();
    }
    exit(4);
}

$trunk = $CONFIG['telephony']['outbound_trunk'];
$dialString = "PJSIP/{$rawDest}@{$trunk}";

$maxMs = (int)($maxSeconds * 1000);
$warningMs = ($maxSeconds > 120) ? 60000 : 30000;
$dialParams = "{$dialString},60,tTL({$maxMs}:{$warningMs}:30000)";

$callDuration = 0;
$disposition = 'FAILED';
$dialStatus = 'UNKNOWN';

if ($agi->is_agi) {
    $agi->verbose("[OUTBOUND DIAL] Forwarding to {$dialString} (Limit: {$maxSeconds}s)");
    $agi->execute('Dial', $dialParams);

    $dialStatus = $agi->get_variable('DIALSTATUS') ?? 'UNKNOWN';
    $answeredTime = intval($agi->get_variable('ANSWEREDTIME') ?? 0);
    $callDuration = $answeredTime;

    switch ($dialStatus) {
        case 'ANSWER':
            $disposition = 'ANSWERED';
            break;
        case 'BUSY':
            $disposition = 'BUSY';
            break;
        case 'NOANSWER':
            $disposition = 'NO ANSWER';
            break;
        case 'CANCEL':
            $disposition = 'CANCELED';
            break;
        case 'CONGESTION':
        case 'CHANUNAVAIL':
            $disposition = 'FAILED';
            break;
        default:
            $disposition = ($callDuration > 0) ? 'ANSWERED' : 'FAILED';
            break;
    }
} else {
    $simulatedSecs = isset($argv[3]) ? intval($argv[3]) : 45;
    $callDuration = min($simulatedSecs, (int)$maxSeconds);
    $disposition = 'ANSWERED';
    echo "\n[SIMULATION] Simulated call to {$dialString} answered for {$callDuration}s.\n";
}

$callCost = 0.0000;

if ($disposition === 'ANSWERED' && $callDuration > 0) {
    $billedMinutes = ceil($callDuration / 60);
    $callCost = round($billedMinutes * $ratePerMin, 4);

    deductBalance($pdo, $user['user_id'], $callCost);

    $newBalance = max(0.00, $userBal - $callCost);
    $agi->verbose(sprintf("[OUTBOUND BILLED] Duration: %ds (%d min) | Rate: $%.4f/min | Cost: $%.4f | New Balance: $%.2f",
        $callDuration, $billedMinutes, $ratePerMin, $callCost, $newBalance));
} else {
    $agi->verbose("[OUTBOUND UNANSWERED] Call status: {$dialStatus} ({$disposition}). Duration: {$callDuration}s. Cost: $0.00");
}

$cdrId = logCdr($pdo, $user['user_id'], $callerExt, $rawDest, $callDuration, $disposition, $callCost);

$summary = sprintf(
    "OUTBOUND SUMMARY: Caller=%s(%s) | Dest=%s(%s) | Disp=%s | Dur=%ds | Rate=$%.4f | Cost=$%.4f | CDR=#%s",
    $callerExt,
    $user['user_name'],
    $rawDest,
    $matchedRate['country_name'],
    $disposition,
    $callDuration,
    $ratePerMin,
    $callCost,
    $cdrId ?? 'N/A'
);
$agi->verbose($summary);

if ($agi->is_agi) {
    $agi->hangup();
}

exit(0);
