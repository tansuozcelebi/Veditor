<?php
/**
 * Veditor – server-side media conversion.
 *
 * Converting in the browser works everywhere but is slow: WebAssembly runs on one thread, so a long
 * HEVC clip can take minutes. When the site's own host has ffmpeg, this endpoint does the same job
 * natively and the editor uses it instead, falling back to the in-browser converter when it cannot.
 *
 * Endpoints (all relative to this file):
 *   GET  ?action=health              → what this host can do
 *   POST ?action=start   (file=…)    → queue a conversion, returns {job}
 *   GET  ?action=status&job=…        → {state, progress, error}
 *   GET  ?action=result&job=…        → the converted file (WebM)
 *   POST ?action=cancel&job=…        → stop and clean up
 *
 * Configuration (environment, or config.php next to this file returning an array):
 *   ffmpeg        path to the ffmpeg binary (default: bin/ffmpeg here, then PATH)
 *   workdir       where jobs live       (default: system temp)
 *   max_bytes     largest accepted file (default: the smaller of PHP's limits, capped at 4 GB)
 *   max_jobs      conversions at once   (default: 2 – shared hosting is not a render farm)
 *   token         when set, requests must send X-Veditor-Token with this value
 *   ttl_seconds   how long finished jobs are kept (default: 1800)
 */

declare(strict_types=1);

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const ALLOWED_EXT = ['mp4', 'm4v', 'mov', 'qt', 'mkv', 'webm', 'avi', 'divx', 'wmv', 'asf', 'flv', 'f4v', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'vob', 'mxf', 'ogv', 'hevc', 'h264',
                    'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'ac3', 'amr', 'caf', 'mka'];

function config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $file = __DIR__ . '/config.php';
    $fromFile = is_readable($file) ? (require $file) : [];
    $cfg = array_merge([
        'ffmpeg' => getenv('VEDITOR_FFMPEG') ?: null,
        'workdir' => getenv('VEDITOR_WORKDIR') ?: null,
        'max_bytes' => (int) (getenv('VEDITOR_MAX_BYTES') ?: 0),
        'max_jobs' => (int) (getenv('VEDITOR_MAX_JOBS') ?: 2),
        'token' => getenv('VEDITOR_TOKEN') ?: null,
        'ttl_seconds' => (int) (getenv('VEDITOR_TTL') ?: 1800),
    ], is_array($fromFile) ? $fromFile : []);
    return $cfg;
}

function json(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $reason, int $status = 400, array $extra = []): never {
    json(array_merge(['ok' => false, 'error' => $reason], $extra), $status);
}

/** Size in bytes from a php.ini shorthand like "512M". */
function iniBytes(string $key): int {
    $v = trim((string) ini_get($key));
    if ($v === '' || $v === '-1' || $v === '0') return PHP_INT_MAX;
    $unit = strtolower(substr($v, -1));
    $n = (int) $v;
    return match ($unit) { 'g' => $n * 1024 ** 3, 'm' => $n * 1024 ** 2, 'k' => $n * 1024, default => $n };
}

function maxBytes(): int {
    $configured = config()['max_bytes'];
    $limit = min(iniBytes('upload_max_filesize'), iniBytes('post_max_size'), 4 * 1024 ** 3);
    return $configured > 0 ? min($configured, $limit) : $limit;
}

/** The ffmpeg binary to use, or null when this host has none. */
function ffmpegPath(): ?string {
    static $found = false, $path = null;
    if ($found) return $path;
    $found = true;
    $candidates = array_filter([
        config()['ffmpeg'],
        __DIR__ . '/bin/ffmpeg',          // a static build uploaded next to this script
        __DIR__ . '/../bin/ffmpeg',
        '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/bin/ffmpeg',
    ]);
    foreach ($candidates as $c) {
        if (is_string($c) && $c !== '' && is_file($c) && is_executable($c)) { $path = $c; return $path; }
    }
    // last resort: whatever is on PATH
    $which = @shell_exec('command -v ffmpeg 2>/dev/null');
    if (is_string($which) && trim($which) !== '') $path = trim($which);
    return $path;
}

/** What this host's ffmpeg can actually encode – minimal builds are missing the obvious ones. */
function encoders(): array {
    static $list = null;
    if ($list !== null) return $list;
    $list = [];
    $ffmpeg = ffmpegPath();
    if ($ffmpeg && canRunProcesses()) {
        $out = @shell_exec(escapeshellarg($ffmpeg) . ' -hide_banner -encoders 2>&1');
        if (is_string($out) && preg_match_all('/^\s*[VAS][\w.]{5}\s+(\S+)/m', $out, $m)) $list = $m[1];
    }
    return $list;
}

function firstEncoder(array $wanted): ?string {
    $have = encoders();
    foreach ($wanted as $codec) if (in_array($codec, $have, true)) return $codec;
    return null;
}

function canRunProcesses(): bool {
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    return !in_array('proc_open', $disabled, true) && !in_array('shell_exec', $disabled, true) && function_exists('proc_open');
}

function workRoot(): string {
    $dir = config()['workdir'] ?: (sys_get_temp_dir() . '/veditor-convert');
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

function jobDir(string $id): string {
    if (!preg_match('/^[a-f0-9]{16,40}$/', $id)) fail('bad job id', 400);
    return workRoot() . '/' . $id;
}

/** Deletes jobs older than the configured lifetime, so a shared host does not fill up. */
function sweep(): void {
    $ttl = max(60, config()['ttl_seconds']);
    foreach (glob(workRoot() . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        if (time() - (int) @filemtime($dir) < $ttl) continue;
        foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
        @rmdir($dir);
    }
}

function runningJobs(): int {
    $n = 0;
    foreach (glob(workRoot() . '/*/state', GLOB_NOSORT) ?: [] as $file) {
        if (trim((string) @file_get_contents($file)) === 'running') $n++;
    }
    return $n;
}

/** Stops the encoder of a job that was cancelled, so an abandoned upload does not keep a core busy. */
function killJob(string $dir): void {
    $pid = (int) trim((string) @file_get_contents($dir . '/pid'));
    if ($pid <= 1) return;
    if (function_exists('posix_kill')) { @posix_kill($pid, 15); return; }
    if (canRunProcesses()) @shell_exec('kill -TERM ' . escapeshellarg((string) $pid) . ' 2>/dev/null');
}

function requireToken(): void {
    $token = config()['token'];
    if (!$token) return;
    $sent = $_SERVER['HTTP_X_VEDITOR_TOKEN'] ?? '';
    if (!hash_equals((string) $token, (string) $sent)) fail('unauthorised', 401);
}

/** ffmpeg writes its progress to a file; turn that plus the duration it reported into a 0..1 ratio. */
function readProgress(string $dir): float {
    $progress = @file_get_contents($dir . '/progress');
    $log = @file_get_contents($dir . '/log');
    if (!is_string($progress) || !is_string($log)) return 0.0;
    if (!preg_match('/Duration:\s*(\d+):(\d+):(\d+\.\d+)/', $log, $d)) return 0.0;
    $total = (int) $d[1] * 3600 + (int) $d[2] * 60 + (float) $d[3];
    if ($total <= 0) return 0.0;
    if (!preg_match_all('/out_time_us=(\d+)/', $progress, $m)) return 0.0;
    $done = ((float) end($m[1])) / 1_000_000;
    return max(0.0, min(1.0, $done / $total));
}

$action = $_GET['action'] ?? 'health';

if ($action === 'health') {
    $ffmpeg = ffmpegPath();
    $version = null;
    if ($ffmpeg && canRunProcesses()) {
        $out = @shell_exec(escapeshellarg($ffmpeg) . ' -hide_banner -version 2>&1');
        if (is_string($out) && preg_match('/ffmpeg version (\S+)/', $out, $m)) $version = $m[1];
    }
    $ok = $ffmpeg !== null && $version !== null && canRunProcesses() && is_writable(workRoot());
    json([
        'ok' => $ok,
        'ffmpeg' => $ok ? $version : null,
        'reason' => $ok ? null : (!canRunProcesses() ? 'processes-disabled' : ($ffmpeg === null ? 'ffmpeg-missing' : (!is_writable(workRoot()) ? 'workdir-not-writable' : 'ffmpeg-not-runnable'))),
        'video' => $ok ? firstEncoder(['libvpx', 'libvpx-vp9', 'vp8', 'vp9']) : null,
        'audio' => $ok ? firstEncoder(['libvorbis', 'libopus', 'vorbis', 'opus']) : null,
        'maxBytes' => maxBytes(),
        'maxJobs' => config()['max_jobs'],
        'tokenRequired' => (bool) config()['token'],
    ]);
}

if ($action === 'start') {
    requireToken();
    sweep();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST required', 405);
    $ffmpeg = ffmpegPath();
    if (!$ffmpeg || !canRunProcesses()) fail('conversion is not available on this host', 503, ['reason' => 'ffmpeg-missing']);
    if (runningJobs() >= max(1, config()['max_jobs'])) fail('too many conversions in progress', 429, ['reason' => 'busy']);

    $file = $_FILES['file'] ?? null;
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $code = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        $tooBig = in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        fail($tooBig ? 'file is larger than this host accepts' : 'no file received', $tooBig ? 413 : 400, ['reason' => $tooBig ? 'too-large' : 'no-file', 'maxBytes' => maxBytes()]);
    }
    if ($file['size'] > maxBytes()) fail('file is larger than this host accepts', 413, ['reason' => 'too-large', 'maxBytes' => maxBytes()]);
    $ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
    if ($ext !== '' && !in_array($ext, ALLOWED_EXT, true)) fail('unsupported file type', 415, ['reason' => 'unsupported']);

    $id = bin2hex(random_bytes(12));
    $dir = jobDir($id);
    if (!@mkdir($dir, 0700, true)) fail('could not create a work directory', 500);
    // the upload keeps only a generated name: nothing from the client reaches the shell
    $input = $dir . '/input' . ($ext !== '' ? '.' . $ext : '');
    if (!move_uploaded_file($file['tmp_name'], $input) && !rename($file['tmp_name'], $input)) fail('could not store the upload', 500);
    @file_put_contents($dir . '/name', (string) $file['name']);
    @file_put_contents($dir . '/state', 'running');

    // WebM the browser can always play: VP8/VP9 video with Vorbis or Opus audio, 8-bit 4:2:0, ≤1080p.
    // Builds vary, so ask this ffmpeg what it has rather than assuming.
    $vcodec = firstEncoder(['libvpx', 'libvpx-vp9', 'vp8', 'vp9']);
    if (!$vcodec) fail('this host\'s ffmpeg cannot write WebM video', 503, ['reason' => 'no-encoder']);
    $acodec = firstEncoder(['libvorbis', 'libopus', 'vorbis', 'opus']);
    $audio = $acodec ? '-map 0:a:0? -c:a ' . escapeshellarg($acodec) . ' -b:a 128k' : '-an';
    $cmd = escapeshellarg($ffmpeg) . ' -hide_banner -nostdin -y'
        . ' -i ' . escapeshellarg($input)
        . ' -map 0:v:0? ' . $audio
        . ' -c:v ' . escapeshellarg($vcodec) . ' -b:v 2M -crf 30 -deadline realtime -cpu-used 8'
        . ' -vf ' . escapeshellarg("scale='min(1920,iw)':-2,format=yuv420p") . ' -pix_fmt yuv420p'
        . ' -progress ' . escapeshellarg($dir . '/progress') . ' -nostats'
        . ' ' . escapeshellarg($dir . '/output.webm');
    // Run detached so the browser is not holding an HTTP request open for minutes. The encoder's own
    // pid is recorded first, so ?action=cancel can stop a conversion nobody is waiting for any more.
    $shell = '(' . $cmd . ' > ' . escapeshellarg($dir . '/log') . ' 2>&1 & '
        . 'echo $! > ' . escapeshellarg($dir . '/pid') . '; '
        . 'wait $!; echo $? > ' . escapeshellarg($dir . '/exit') . '; '
        . 'if [ -s ' . escapeshellarg($dir . '/output.webm') . ' ] && [ "$(cat ' . escapeshellarg($dir . '/exit') . ')" = "0" ]; '
        . 'then echo done > ' . escapeshellarg($dir . '/state') . '; else echo error > ' . escapeshellarg($dir . '/state') . '; fi) > /dev/null 2>&1 &';
    @shell_exec($shell);
    json(['ok' => true, 'job' => $id]);
}

if ($action === 'status') {
    requireToken();
    $dir = jobDir((string) ($_GET['job'] ?? ''));
    if (!is_dir($dir)) fail('unknown job', 404, ['reason' => 'unknown-job']);
    $state = trim((string) @file_get_contents($dir . '/state')) ?: 'running';
    $out = ['ok' => true, 'state' => $state, 'progress' => $state === 'done' ? 1.0 : readProgress($dir)];
    if ($state === 'error') {
        $log = (string) @file_get_contents($dir . '/log');
        $lines = array_slice(array_filter(explode("\n", trim($log))), -8);
        $out['error'] = 'conversion failed';
        $out['log'] = $lines;
    }
    json($out);
}

if ($action === 'result') {
    requireToken();
    $dir = jobDir((string) ($_GET['job'] ?? ''));
    $file = $dir . '/output.webm';
    if (!is_file($file)) fail('result is not ready', 404, ['reason' => 'not-ready']);
    $name = pathinfo(trim((string) @file_get_contents($dir . '/name')) ?: 'video', PATHINFO_FILENAME);
    header('Content-Type: video/webm');
    header('Content-Length: ' . filesize($file));
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^\w.-]+/u', '_', $name) . '.webm"');
    readfile($file);
    exit;
}

if ($action === 'cancel') {
    requireToken();
    $dir = jobDir((string) ($_GET['job'] ?? ''));
    if (is_dir($dir)) {
        killJob($dir);
        @file_put_contents($dir . '/state', 'cancelled');
        foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
        @rmdir($dir);
    }
    json(['ok' => true]);
}

fail('unknown action', 404);
