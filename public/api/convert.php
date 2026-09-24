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
 *   POST ?action=start (file=…, formats=webm,mp4) → queue a conversion, returns {job, format}
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

/**
 * What this host can actually write, per container. Builds differ wildly: a shared host often has an
 * ffmpeg without libvpx (no WebM video at all) but with x264, so offering only WebM would mean
 * accepting an upload and then refusing it. The browser picks from this list what it can play.
 */
function formats(): array {
    static $map = null;
    if ($map !== null) return $map;
    $candidates = [
        'webm' => [
            'video' => ['libvpx', 'libvpx-vp9', 'vp8', 'vp9', 'libsvtav1', 'libaom-av1', 'librav1e'],
            'audio' => ['libvorbis', 'libopus', 'vorbis', 'opus'],
        ],
        'mp4' => [
            // software first: a listed hardware encoder usually has no device behind it on shared hosting
            'video' => ['libx264', 'libopenh264', 'libx265', 'h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_v4l2m2m', 'hevc_nvenc'],
            'audio' => ['aac', 'libfdk_aac', 'libmp3lame', 'mp3'],
        ],
    ];
    $map = [];
    foreach ($candidates as $format => $wanted) {
        foreach ($wanted['video'] as $video) {
            if (!in_array($video, encoders(), true)) continue;
            // Being listed is not the same as working: h264_v4l2m2m, h264_vaapi and friends are compiled
            // in but fail without their device. Ask this ffmpeg to encode a fraction of a second and see.
            $audio = firstEncoder($wanted['audio']);
            $withAudio = $audio !== null ? encodes($format, $video, $audio) : 'no';
            if ($withAudio !== 'no') { $map[$format] = ['video' => $video, 'audio' => $audio, 'tested' => $withAudio === 'ok']; break; }
            $videoOnly = encodes($format, $video, null);
            if ($videoOnly !== 'no') { $map[$format] = ['video' => $video, 'audio' => null, 'tested' => $videoOnly === 'ok']; break; }
        }
    }
    return $map;
}

/**
 * Encodes a fraction of a second of black video (and silence) to prove the encoder really runs here.
 * The answer is cached in the work directory, because it costs an ffmpeg start-up per combination.
 */
function encodes(string $format, string $video, ?string $audio): string {
    $ffmpeg = ffmpegPath();
    if (!$ffmpeg || !canRunProcesses()) return 'no';
    // the leading version makes an answer from an older, weaker probe unusable instead of sticky
    $cache = workRoot() . '/probe-' . substr(sha1('v2|' . $ffmpeg . '|' . $format . '|' . $video . '|' . (string) $audio), 0, 16);
    if (is_file($cache) && time() - (int) @filemtime($cache) < 86400) {
        $cached = trim((string) @file_get_contents($cache));
        if (in_array($cached, ['ok', 'no', 'untested'], true)) return $cached;
    }
    $out = workRoot() . '/probe-' . bin2hex(random_bytes(6)) . '.' . $format;
    $cmd = escapeshellarg($ffmpeg) . ' -hide_banner -nostdin -y -timelimit 10'
        . ' -f lavfi -i ' . escapeshellarg('color=c=black:s=64x64:r=10:d=0.3')
        . ' -f lavfi -i ' . escapeshellarg('anullsrc=r=44100:cl=mono')
        . ' -map 0:v -c:v ' . escapeshellarg($video) . ' -pix_fmt yuv420p'
        . ($audio !== null ? ' -map 1:a -c:a ' . escapeshellarg($audio) . ' -strict -2' : ' -an')
        . ' -t 0.3 ' . escapeshellarg($out) . ' 2>&1; echo "veditor-exit:$?"';
    $log = (string) @shell_exec($cmd);
    // The exit code is what counts: MP4 writes its header before the first frame, so a file exists
    // even when the encoder dies straight after opening (what a hardware encoder without a device does).
    $code = preg_match('/veditor-exit:(\d+)/', $log, $m) ? (int) $m[1] : 1;
    $made = $code === 0 && is_file($out) && filesize($out) > 0;
    @unlink($out);
    // A build stripped to the codecs it needs (Playwright ships one) has no lavfi and cannot generate
    // the test clip at all. That says nothing about the encoder, so the list is trusted – but the
    // health report says so, rather than claiming the encoder was tried.
    $verdict = $made ? 'ok'
        : (preg_match('/Unknown input format|Unrecognized option|No such filter|Error opening input|Option not found|Unknown option/i', $log) ? 'untested' : 'no');
    @file_put_contents($cache, $verdict);
    return $verdict;
}

const MIME = ['webm' => 'video/webm', 'mp4' => 'video/mp4'];

/** ffmpeg arguments for one container, as an already-escaped string. */
function encodeArgs(string $format, array $codecs): string {
    $native = in_array($codecs['audio'], ['vorbis', 'opus', 'aac'], true); // built-in encoders may be flagged experimental
    $audio = $codecs['audio']
        ? '-map 0:a:0? -c:a ' . escapeshellarg($codecs['audio']) . ' -b:a 128k' . ($native ? ' -strict -2' : '')
        : '-an';
    $video = '-c:v ' . escapeshellarg($codecs['video']) . ' -b:v 2M';
    // only libx264/libx265 understand -preset; hardware and hand-written encoders reject it
    if (preg_match('/^libx26[45]$/', $codecs['video'])) $video .= ' -preset veryfast -crf 26';
    elseif (preg_match('/^libvpx/', $codecs['video'])) $video .= ' -crf 30 -deadline realtime -cpu-used 8';
    $container = $format === 'mp4' ? ' -movflags +faststart' : '';
    return '-map 0:v:0? ' . $audio . ' ' . $video
        . ' -vf ' . escapeshellarg("scale='min(1920,iw)':-2,format=yuv420p") . ' -pix_fmt yuv420p' . $container;
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
        cleanJob($dir);
    }
}

function runningJobs(): int {
    $n = 0;
    foreach (glob(workRoot() . '/*/state', GLOB_NOSORT) ?: [] as $file) {
        if (trim((string) @file_get_contents($file)) === 'running') $n++;
    }
    return $n;
}

/** Removes a job directory and everything in it. */
function cleanJob(string $dir): void {
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($dir);
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
    $runnable = $ffmpeg !== null && $version !== null && canRunProcesses() && is_writable(workRoot());
    $formats = $runnable ? formats() : [];
    // A host with ffmpeg but no usable video encoder cannot help, and saying otherwise would cost the
    // browser a full upload before the refusal – so it does not count as available.
    $ok = $runnable && $formats !== [];
    json([
        'ok' => $ok,
        'ffmpeg' => $runnable ? $version : null,
        'reason' => $ok ? null : (!canRunProcesses() ? 'processes-disabled' : ($ffmpeg === null ? 'ffmpeg-missing' : (!is_writable(workRoot()) ? 'workdir-not-writable' : ($version === null ? 'ffmpeg-not-runnable' : 'no-encoder')))),
        'formats' => (object) $formats,
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

    // 8-bit 4:2:0 at up to 1080p, in whichever container this host can write and the browser asked
    // for. Builds vary, so ask this ffmpeg what it has rather than assuming.
    $available = formats();
    $wanted = array_values(array_filter(array_map('trim', explode(',', (string) ($_POST['formats'] ?? '')))));
    $format = null;
    foreach ($wanted ?: array_keys($available) as $candidate) if (isset($available[$candidate])) { $format = $candidate; break; }
    if (!$format) {
        cleanJob($dir);
        fail($available === [] ? 'this host\'s ffmpeg cannot encode video' : 'this host cannot write any of the requested formats', 503, ['reason' => 'no-encoder', 'formats' => (object) $available]);
    }
    @file_put_contents($dir . '/ext', $format);
    $cmd = escapeshellarg($ffmpeg) . ' -hide_banner -nostdin -y'
        . ' -i ' . escapeshellarg($input)
        . ' ' . encodeArgs($format, $available[$format])
        . ' -progress ' . escapeshellarg($dir . '/progress') . ' -nostats'
        . ' ' . escapeshellarg($dir . '/output.' . $format);
    // Run detached so the browser is not holding an HTTP request open for minutes. The encoder's own
    // pid is recorded first, so ?action=cancel can stop a conversion nobody is waiting for any more.
    $shell = '(' . $cmd . ' > ' . escapeshellarg($dir . '/log') . ' 2>&1 & '
        . 'echo $! > ' . escapeshellarg($dir . '/pid') . '; '
        . 'wait $!; echo $? > ' . escapeshellarg($dir . '/exit') . '; '
        . 'if [ -s ' . escapeshellarg($dir . '/output.' . $format) . ' ] && [ "$(cat ' . escapeshellarg($dir . '/exit') . ')" = "0" ]; '
        . 'then echo done > ' . escapeshellarg($dir . '/state') . '; else echo error > ' . escapeshellarg($dir . '/state') . '; fi) > /dev/null 2>&1 &';
    @shell_exec($shell);
    json(['ok' => true, 'job' => $id, 'format' => $format]);
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
    $ext = trim((string) @file_get_contents($dir . '/ext'));
    if (!isset(MIME[$ext])) $ext = 'webm';
    $file = $dir . '/output.' . $ext;
    if (!is_file($file)) fail('result is not ready', 404, ['reason' => 'not-ready']);
    $name = pathinfo(trim((string) @file_get_contents($dir . '/name')) ?: 'video', PATHINFO_FILENAME);
    header('Content-Type: ' . MIME[$ext]);
    header('Content-Length: ' . filesize($file));
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^\w.-]+/u', '_', $name) . '.' . $ext . '"');
    readfile($file);
    exit;
}

if ($action === 'cancel') {
    requireToken();
    $dir = jobDir((string) ($_GET['job'] ?? ''));
    if (is_dir($dir)) {
        killJob($dir);
        @file_put_contents($dir . '/state', 'cancelled');
        cleanJob($dir);
    }
    json(['ok' => true]);
}

fail('unknown action', 404);
