<?php
/**
 * Router for PHP's built-in server, used by the smoke test to serve the production build the way
 * SiteGround does: real files (including api/convert.php) as themselves, everything else as the SPA.
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = $_SERVER['DOCUMENT_ROOT'] . $path;
if ($path !== '/' && is_file($file)) return false; // let the built-in server serve (and execute) it
header('Content-Type: text/html; charset=utf-8');
readfile($_SERVER['DOCUMENT_ROOT'] . '/index.html');
