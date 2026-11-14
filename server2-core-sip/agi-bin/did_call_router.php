#!/usr/bin/php
<?php
/**
 * ============================================================================
 * SipMyNumber — Intelligent DID Call Router & CDR Processor
 * Server: 192.168.88.51 (Core SIP Switch)
 * Database: 192.168.88.119 (MySQL vpl_crm)
 * WebRTC Edge: 192.168.88.47 (Kamailio 6.1)
 * ============================================================================
 */

error_reporting(E_ALL);
ini_set('display_errors', '0'); // Prevent breaking Asterisk AGI stream

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
        'kamailio_host'  => '192.168.88.47', // Kamailio WebRTC Proxy
        'kamailio_port'  => 5060,
        'outbound_trunk' => 'VPL-OUTBOUND',
        'per_min_rate'   => 0.015,          // $0.015 / minute
    ]
];

// ============================================================================
// AGI ENGINE CLASS
// ============================================================================
class AsteriskAGI {
    private $in;
    private $out;
    public $is_agi = false;
    public $agi_vars = [];

    public function __construct() {
        $this->in = defined('STDIN') ? STDIN : fopen('php://stdin', 'r');
        $this->out = defined('STDOUT') ? STDOUT : fopen('php://stdout', 'w');

        // Check if running on Windows
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            $this->is_agi = false;
            return;
        }

        // If interactive shell (CLI), run in CLI simulation mode
        if (function_exists('posix_isatty') && posix_isatty($this->in)) {
            $this->is_agi = false;
            return;
        }

        // Check AGI environment variables or non-blocking STDIN test
        if (isset($_SERVER['AGI_REQUEST']) || isset($_ENV['AGI_REQUEST'])) {
            $this->is_agi = true;
            $this->read_environment();
            return;
        }

        // Test if STDIN has Asterisk AGI headers
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
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

// ============================================================================
// INITIALIZATION
// ============================================================================
$agi = new AsteriskAGI();

// Determine Inbound DID and CallerID
$rawDid = '';
if ($agi->is_agi && isset($agi->agi_vars['agi_extension'])) {
    $rawDid = $agi->agi_vars['agi_extension'];
}
if (!empty($argv[1])) {
    $rawDid = $argv[1];
}

$callerArg = '';
if ($agi->is_agi && isset($agi->agi_vars['agi_callerid'])) {
    $callerArg = $agi->agi_vars['agi_callerid'];
}
if (!empty($argv[2])) {
    $callerArg = $argv[2];
}
if (empty($callerArg)) {
    $callerArg = 'Anonymous';
}

// Extract DID from SIP URI if format is sip:number@host
if (preg_match('/sip:([^@>]+)/i', $rawDid, $m)) {
    $rawDid = $m[1];
}

// If DID is 's', inspect To header or DNID
if ($rawDid === 's' || empty($rawDid)) {
    if (!empty($agi->agi_vars['agi_dnid']) && $agi->agi_vars['agi_dnid'] !== 's') {
        $rawDid = $agi->agi_vars['agi_dnid'];
    } elseif ($agi->is_agi) {
        $toHdr = $agi->get_variable('PJSIP_HEADER(read,To)') ?: $agi->get_variable('SIP_HEADER(To)');
        if ($toHdr && preg_match('/sip:([^@>]+)/i', $toHdr, $m)) {
            $rawDid = $m[1];
        }
    }
}

// Clean DID
$cleanDid = preg_replace('/[^0-9+]/', '', $rawDid);
$withPlus = str_starts_with($cleanDid, '+') ? $cleanDid : '+' . $cleanDid;
$numOnly  = ltrim($cleanDid, '+');

$agi->verbose("===> [SipMyNumber] Inbound Call on 88.51: DID={$cleanDid} (Caller={$callerArg}) <===");

// ============================================================================
// DATABASE CONNECTION
// ============================================================================
try {
    $pdo = getDbConnection($CONFIG['db']);
} catch (Exception $e) {
    $agi->verbose("[FATAL] Database connection failed: " . $e->getMessage(), 1);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'all-circuits-busy-now');
        $agi->hangup();
    }
    exit(1);
}

// ============================================================================
// STEP 1: DID AVAILABILITY & ALLOCATION CHECK
// ============================================================================
$stmt = $pdo->prepare("
    SELECT 
        d.id AS did_id,
        d.did_number,
        d.status AS did_status,
        d.country,
        ud.id AS user_did_id,
        ud.user_id,
        ud.forward_type,
        ud.forward_destination,
        ud.is_active AS route_active,
        u.name AS user_name,
        u.email AS user_email,
        u.balance AS user_balance,
        u.role
    FROM inventory_dids d
    LEFT JOIN user_dids ud ON d.id = ud.did_id AND ud.is_active = 1
    LEFT JOIN users u ON ud.user_id = u.id
    WHERE d.did_number = :did_plus OR d.did_number = :did_num
    LIMIT 1
");

$stmt->execute([
    ':did_plus' => $withPlus,
    ':did_num'  => $numOnly
]);

$record = $stmt->fetch();

if (!$record) {
    $agi->verbose("[REJECT] DID $cleanDid NOT found in inventory database!");
    logCdr($pdo, null, $callerArg, $cleanDid, 0, 'FAILED_DID_NOT_FOUND', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'ss-noservice');
        $agi->hangup();
    }
    exit(1);
}

if ($record['did_status'] !== 'allocated' || empty($record['user_id'])) {
    $agi->verbose("[REJECT] DID $cleanDid is in inventory ({$record['did_status']}) but UNALLOCATED!");
    logCdr($pdo, null, $callerArg, $cleanDid, 0, 'UNALLOCATED_DID', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'ss-noservice');
        $agi->hangup();
    }
    exit(2);
}

if (empty($record['route_active']) || $record['route_active'] != 1) {
    $agi->verbose("[REJECT] DID $cleanDid allocated to User #{$record['user_id']} but route is INACTIVE!");
    logCdr($pdo, $record['user_id'], $callerArg, $cleanDid, 0, 'ROUTE_INACTIVE', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'cannot-complete-as-dialed');
        $agi->hangup();
    }
    exit(3);
}

// ============================================================================
// STEP 2: USER BALANCE GUARD CHECK
// ============================================================================
$userId = (int)$record['user_id'];
$userName = $record['user_name'];
$userBalance = (float)$record['user_balance'];

$agi->verbose("[STATUS] DID Owner: {$userName} (ID: {$userId}) | Current Balance: \${$userBalance}");

if ($userBalance <= 0.00) {
    $agi->verbose("[BALANCE GUARD] Call REJECTED: User {$userName} balance is zero or negative (\${$userBalance})!");
    logCdr($pdo, $userId, $callerArg, $cleanDid, 0, 'REJECTED_ZERO_BALANCE', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'cannot-complete-as-dialed');
        $agi->hangup();
    }
    exit(4);
}

// ============================================================================
// STEP 3: RESOLVE MODAL FORWARDING OPTION
// ============================================================================
$forwardType = strtoupper(trim($record['forward_type'] ?? 'SIP_URI'));
$destination = trim($record['forward_destination'] ?? '');

if (empty($destination)) {
    $agi->verbose("[REJECT] No forwarding destination configured for DID $cleanDid!");
    logCdr($pdo, $userId, $callerArg, $cleanDid, 0, 'FAILED_NO_DESTINATION', 0.00);
    if ($agi->is_agi) {
        $agi->execute('Playback', 'cannot-complete-as-dialed');
        $agi->hangup();
    }
    exit(5);
}

$optionName = '';
$dialString = '';
$ringTimeout = 60;

$kamHost = $CONFIG['telephony']['kamailio_host'];
$kamPort = $CONFIG['telephony']['kamailio_port'];

if ($forwardType === 'PSTN') {
    // ------------------------------------------------------------------------
    // OPTION 2: Forward to Mobile / PSTN Phone Number
    // ------------------------------------------------------------------------
    $optionName = 'Option 2: Mobile / PSTN Phone Number';
    $trunk = $CONFIG['telephony']['outbound_trunk'];
    $dialString = "PJSIP/{$destination}@{$trunk}";
    $ringTimeout = 60;
} elseif ($forwardType === 'SIP_URI') {
    if (preg_match('/^[0-9]{4,6}$/', $destination)) {
        // --------------------------------------------------------------------
        // OPTION 1: Receive on WebRTC Softphone (Ext order_id)
        // --------------------------------------------------------------------
        $optionName = "Option 1: WebRTC Softphone (Ext {$destination})";
        $dialString = "PJSIP/kamailio-edge/sip:{$destination}@{$kamHost}:5062";
        $ringTimeout = 60;
    } else {
        // --------------------------------------------------------------------
        // OPTION 3: Forward to External SIP IP Address / PBX
        // --------------------------------------------------------------------
        $optionName = "Option 3: External SIP IP Address / PBX ({$destination})";
        
        // Strip sip: prefix if user entered it
        $destClean = preg_replace('/^sips?:/i', '', $destination);
        
        // If destination does not contain a username (e.g., "voice.didx.net" or an IP),
        // automatically append the incoming DID number so the remote switch receives:
        // sip:<DID>@<HOST> instead of an empty username!
        if (!str_contains($destClean, '@')) {
            $destClean = "{$cleanDid}@{$destClean}";
        }
        
        $sipUri = "sip:{$destClean}";
        $dialString = "PJSIP/anonymous/{$sipUri}";
        $ringTimeout = 60;
    }
}

$agi->verbose("[ROUTE RESOLVED] {$optionName}");
$agi->verbose("[DIAL STRING] {$dialString} (Timeout: {$ringTimeout}s)");

// ============================================================================
// STEP 4: EXECUTE CALL FORWARDING
// ============================================================================
$callDuration = 0;
$disposition = 'FAILED';

if ($agi->is_agi) {
    // Preserve caller identity cleanly
    $agi->execute('Set', "CALLERID(name)=\"{$callerArg}\"");
    if (preg_match('/[0-9+]{4,}/', $callerArg, $cm)) {
        $agi->execute('Set', "CALLERID(num)=\"{$cm[0]}\"");
    } else {
        $agi->execute('Set', "CALLERID(num)=\"{$cleanDid}\"");
    }

    $agi->execute('Dial', "{$dialString},{$ringTimeout},tT");

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
    // CLI SIMULATION MODE
    $simulatedSecs = isset($argv[3]) ? intval($argv[3]) : 20;
    $callDuration = $simulatedSecs;
    $disposition = ($callDuration > 0) ? 'ANSWERED' : 'FAILED';
    echo "\n[SIMULATION] Simulated call to {$dialString} answered for {$callDuration}s.\n";
}

// ============================================================================
// STEP 5: CDR LOGGING & BALANCE BILLING
// ============================================================================
$billedRate = $CONFIG['telephony']['per_min_rate'];
$callCost = 0.0000;

if ($disposition === 'ANSWERED' && $callDuration > 0) {
    $minutes = ceil($callDuration / 60);
    $callCost = round($minutes * $billedRate, 4);
    deductBalance($pdo, $userId, $callCost);
    $newBalance = max(0.00, $userBalance - $callCost);
    $agi->verbose(sprintf("[BALANCE DEDUCTED] Cost: $%.2f | New Balance: $%.2f", $callCost, $newBalance));
}

$cdrId = logCdr($pdo, $userId, $callerArg, $cleanDid, $callDuration, $disposition, $callCost);

$summary = sprintf(
    "CALL SUMMARY: DID=%s | Owner=%s(#%d) | Target=%s | Disp=%s | Dur=%ds | Cost=$%.4f | CDR=#%s",
    $cleanDid,
    $userName,
    $userId,
    $dialString,
    $disposition,
    $callDuration,
    $callCost,
    $cdrId ?? 'N/A'
);

$agi->verbose($summary);

if ($agi->is_agi) {
    $agi->hangup();
}

exit(0);
