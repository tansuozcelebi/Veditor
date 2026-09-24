<?php
/**
 * Veditor – server-side conversion settings.
 *
 * Copy this file to config.php next to convert.php and change what you need. Every value is
 * optional; the defaults work on a host that already has ffmpeg on its PATH. The .htaccess in this
 * folder denies config.php over HTTP, so it is never served as a file.
 */
return [
    // Path to the ffmpeg binary. Leave null to search bin/ffmpeg here, the usual system paths and PATH.
    // On SiteGround (no system ffmpeg) upload a static Linux build to public_html/api/bin/ffmpeg and
    // make it executable: chmod 755 bin/ffmpeg
    'ffmpeg' => null,

    // Where jobs are stored while they run. Must be writable; anything under the document root should
    // be denied over HTTP. null = the system temp directory.
    'workdir' => null,

    // Largest file accepted, in bytes. The host's own upload_max_filesize / post_max_size still apply,
    // whichever is smaller wins. 0 = only the PHP limits.
    'max_bytes' => 0,

    // How many conversions may run at the same time. Shared hosting is not a render farm.
    'max_jobs' => 2,

    // When set, requests must send the same value in an X-Veditor-Token header. Use it if the editor
    // is not public: call window.veditor.server.setServerToken('…') (or set it in your host app)
    // before importing. Leave null for an open endpoint.
    'token' => null,

    // How long a finished job is kept before it is swept away, in seconds.
    'ttl_seconds' => 1800,
];
