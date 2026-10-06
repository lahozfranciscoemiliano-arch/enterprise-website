<?php
// Enterprise SOC: formulario "Pide una demo".
// Envia cada pedido a contacto@enterprisesoc.lat y responde JSON al sitio.
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

const TO_ADDR   = 'contacto@enterprisesoc.lat';
const FROM_ADDR = 'web@enterprisesoc.lat';

function reply(int $code, array $data): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function cut(string $s, int $max): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

// Una linea: sin saltos (evita inyectar cabeceras) y con largo maximo
function field(string $key, int $max): string {
    $v = isset($_POST[$key]) ? trim((string) $_POST[$key]) : '';
    return cut(str_replace(["\r", "\n", "\0"], ' ', $v), $max);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') reply(405, ['ok' => false]);

// Campo trampa: las personas no lo ven; si viene lleno es un bot. Se responde ok y no se envia nada.
if (!empty($_POST['website'])) reply(200, ['ok' => true]);

$nombre     = field('nombre', 100);
$empresa    = field('empresa', 120);
$email      = field('email', 160);
$servidores = field('servidores', 40);
$fortinet   = field('fortinet', 20);
$variante   = strtoupper(field('variante', 20));
$mensaje   = isset($_POST['mensaje']) ? cut(trim(str_replace("\0", '', (string) $_POST['mensaje'])), 3000) : '';

if ($nombre === '' || $empresa === '' || $servidores === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    reply(422, ['ok' => false, 'error' => 'invalid']);
}

// Version del titulo de portada que vio la persona (prueba A/B). Solo valores conocidos.
$TITULOS = [
    'A' => 'A, "Te enteras antes de que llame el usuario."',
    'B' => 'B, "Tus sedes tienen guardia toda la noche."',
    'C' => 'C, "Todas tus sedes en una sola pantalla."',
];
$titulo = $TITULOS[$variante] ?? 'no pasó por la portada';

// Limite simple: hasta 5 pedidos por IP cada 10 minutos
$dir = sys_get_temp_dir() . '/esoc-form';
if (!is_dir($dir)) @mkdir($dir, 0700, true);
$file = $dir . '/' . hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'x');
$now  = time();
$hits = [];
if (is_file($file)) {
    foreach (explode(',', (string) @file_get_contents($file)) as $t) {
        if ((int) $t > $now - 600) $hits[] = (int) $t;
    }
}
if (count($hits) >= 5) reply(429, ['ok' => false, 'error' => 'rate']);
$hits[] = $now;
@file_put_contents($file, implode(',', $hits), LOCK_EX);

$subject = 'Pedido de demo: ' . $empresa;
$body = "Nuevo pedido de demo desde enterprisesoc.lat\n\n"
      . "Nombre: $nombre\n"
      . "Empresa: $empresa\n"
      . "Email: $email\n"
      . "Servidores: $servidores\n"
      . 'Usa Fortinet: ' . ($fortinet !== '' ? $fortinet : 'sin respuesta') . "\n"
      . "Título de portada que vio: $titulo\n\n"
      . "Mensaje:\n" . ($mensaje !== '' ? $mensaje : '(sin mensaje)') . "\n";

$headers = implode("\r\n", [
    'From: Enterprise SOC <' . FROM_ADDR . '>',
    'Reply-To: ' . $email,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
]);

$sent = @mail(TO_ADDR, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers, '-f' . FROM_ADDR);
if (!$sent) reply(500, ['ok' => false, 'error' => 'mail']);

reply(200, ['ok' => true]);
