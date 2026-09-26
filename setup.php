<?php
declare(strict_types=1);

@session_start();
if (empty($_SESSION['mytoko_csrf'])) {
    $_SESSION['mytoko_csrf'] = bin2hex(random_bytes(16));
}

/* =========================================================================
   KONFIGURASI
   ========================================================================= */
$TemplateWebDir = __DIR__ . DIRECTORY_SEPARATOR . 'web';                       // master template: index.html + admin/
$StoreBaseDir   = getenv('MYTOKO_STORE_BASE') ?: __DIR__ . DIRECTORY_SEPARATOR . 'stores';
$MaxUploadBytes = 3 * 1024 * 1024;                                             // 3 MB per gambar
$AllowedMime    = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];

$errors   = [];
$feedback = [];
$gitLog   = [];

/* =========================================================================
   FUNGSI BANTU
   ========================================================================= */
function escapeHtml(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function cleanStr(?string $value): string
{
    return trim((string) $value);
}

function slugify(string $value): string
{
    $slug = strtolower(trim($value));
    $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
    return trim($slug, '-') !== '' ? trim($slug, '-') : 'toko';
}

function formatRupiah($angka): string
{
    $bersih = (string) preg_replace('/[^0-9]/', '', (string) $angka);
    $nilai  = (int) ($bersih === '' ? '0' : $bersih);
    return 'Rp' . number_format($nilai, 0, ',', '.');
}

function buatDir(string $dir): ?string
{
    if (is_dir($dir)) {
        return null;
    }
    if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return 'Gagal membuat folder: ' . $dir;
    }
    return null;
}

function hapusRekursif(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $items = scandir($dir);
    if ($items === false) {
        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path) && !is_link($path)) {
            hapusRekursif($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

function tulisFile(string $path, string $konten): ?string
{
    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, $konten, LOCK_EX) === false) {
        return 'Gagal menulis file: ' . $path;
    }
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return 'Gagal menyimpan file: ' . $path;
    }
    return null;
}

function salinFile(string $sumber, string $tujuan): ?string
{
    if (!is_file($sumber)) {
        return 'File template tidak ditemukan: ' . $sumber;
    }
    if (!@copy($sumber, $tujuan)) {
        return 'Gagal menyalin file: ' . $sumber;
    }
    return null;
}

/**
 * Simpan satu file upload gambar ke folder images.
 * Kembali: ['ok' => true, 'path' => "images/nama-file.jpg"] atau
 *          ['ok' => false, 'error' => "pesan"]  (path kosong).
 */
function simpanGambar(array $file, string $imagesDir, string $prefix, array $allowed, int $maxBytes): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return ['ok' => true, 'path' => ''];
    }
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
        return ['ok' => false, 'error' => 'Terjadi kesalahan saat mengunggah berkas (kode ' . $file['error'] . ').'];
    }
    if ((int) ($file['size'] ?? 0) > $maxBytes) {
        return ['ok' => false, 'error' => 'Ukuran gambar melebihi 3 MB.'];
    }

    $tmp = (string) ($file['tmp_name'] ?? '');
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        return ['ok' => false, 'error' => 'Berkas sementara tidak ditemukan.'];
    }

    // Deteksi tipe MIME asli.
    $mime = '';
    if (function_exists('finfo_open')) {
        $fin  = finfo_open(FILEINFO_MIME_TYPE);
        $mime = (string) @finfo_file($fin, $tmp);
        finfo_close($fin);
    } elseif (function_exists('mime_content_type')) {
        $mime = (string) @mime_content_type($tmp);
    } else {
        $mime = (string) ($file['type'] ?? '');
    }

    // Cari ekstensi berdasarkan kunci MIME (bukan array_search: itu mencari nilai).
    $ekstensi = $allowed[$mime] ?? null;
    if ($ekstensi === null) {
        // Fallback terakhir: andalkan ekstensi nama file + validitas gambar.
        $ekstensi = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        if ($ekstensi === '' || !array_key_exists($ekstensi, $allowed)) {
            return ['ok' => false, 'error' => 'Tipe berkas tidak diizinkan. Gunakan JPG, PNG, GIF, atau WebP.'];
        }
    }

    if (function_exists('getimagesize')) {
        $info = @getimagesize($tmp);
        if ($info === false) {
            return ['ok' => false, 'error' => 'Berkas bukan gambar yang valid.'];
        }
    }

    $nama = $prefix . '-' . date('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '.' . $ekstensi;
    if (!@move_uploaded_file($tmp, $imagesDir . DIRECTORY_SEPARATOR . $nama)) {
        return ['ok' => false, 'error' => 'Gagal memindahkan gambar ke folder images.'];
    }

    return ['ok' => true, 'path' => 'images/' . $nama];
}

function jalankanPerintah(string $cwd, string $perintah): array
{
    $deskriptor = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    // GABUNGKAN environment saat ini + nonaktifkan prompt agar push tidak menggantung.
    $env        = array_merge(getenv(), ['GIT_TERMINAL_PROMPT' => '0']);
    $proses     = @proc_open($perintah, $deskriptor, $pipa, $cwd, $env);
    if (!is_resource($proses)) {
        return ['ok' => false, 'out' => 'Gagal menjalankan: ' . $perintah];
    }
    fclose($pipa[0]);
    $keluaran = stream_get_contents($pipa[1]) . stream_get_contents($pipa[2]);
    fclose($pipa[1]);
    fclose($pipa[2]);
    $kode = proc_close($proses);

    return ['ok' => $kode === 0, 'out' => trim((string) $keluaran)];
}

/* =========================================================================
   RENDER BARIS PRODUK (persisten saat ada galat)
   ========================================================================= */
function renderBarisProduk(array $baris, array $kategori, int $index, bool $tampilkanBerkas = false): string
{
    $nama      = escapeHtml((string) ($baris['nama'] ?? ''));
    $harga     = escapeHtml((string) ($baris['harga'] ?? ''));
    $deskripsi = escapeHtml((string) ($baris['deskripsi'] ?? ''));
    $terpilih  = (string) ($baris['kategori'] ?? '');

    $opsi = '<option value="">Pilih kategori</option>';
    foreach ($kategori as $kat) {
        $kat = (string) $kat;
        $selected = $kat === $terpilih ? ' selected' : '';
        $opsi .= '<option value="' . escapeHtml($kat) . '"' . $selected . '>' . escapeHtml($kat) . '</option>';
    }

    $berkas = $tampilkanBerkas
        ? '<div class="field wide"><label for="produk-gambar-' . $index . '">Upload Foto Produk</label>
           <input id="produk-gambar-' . $index . '" name="produk_gambar[]" type="file" accept="image/*"></div>'
        : '';

    return '<div class="row-produk">'
        . '<div class="product-grid">'
        . '<div class="field wide"><label for="produk-nama-' . $index . '">Nama Produk</label>'
        . '<input id="produk-nama-' . $index . '" name="produk_nama[]" type="text" value="' . $nama . '" required></div>'
        . '<div class="field"><label for="produk-harga-' . $index . '">Harga</label>'
        . '<input id="produk-harga-' . $index . '" name="produk_harga[]" type="text" inputmode="numeric" placeholder="46000" value="' . $harga . '" required></div>'
        . '<div class="field"><label for="produk-kategori-' . $index . '">Kategori</label>'
        . '<select class="produk-kategori" id="produk-kategori-' . $index . '" name="produk_kategori[]" required>' . $opsi . '</select></div>'
        . '<div class="field wide"><label for="produk-deskripsi-' . $index . '">Deskripsi (opsional)</label>'
        . '<textarea id="produk-deskripsi-' . $index . '" name="produk_deskripsi[]" rows="2">' . $deskripsi . '</textarea></div>'
        . $berkas
        . '</div>'
        . '<div class="row-actions"><button type="button" class="secondary hapus-baris">Hapus baris</button></div>'
        . '</div>';
}

function renderDaftarKategori(array $kategori): string
{
    return escapeHtml(implode(PHP_EOL, $kategori));
}

/* =========================================================================
   PROSES FORM
   ========================================================================= */
$terisi = [
    'nama_toko'       => '',
    'tagline'         => '',
    'deskripsi'       => '',
    'whatsapp'        => '',
    'alamat_toko'     => '',
    'jam_operasional' => '',
    'announcement'    => '',
    'github_url'      => '',
    'kategori'        => [],
    'produk'          => [],
];

if ($_SERVER['REQUEST_METHOD'] === 'POST' && cleanStr($_POST['action'] ?? '') === 'run_setup') {
    $tokenForm = cleanStr($_POST['_token'] ?? '');
    if (empty($_SESSION['mytoko_csrf']) || !hash_equals((string) $_SESSION['mytoko_csrf'], $tokenForm)) {
        $errors[] = 'Sesi sudah kedaluwarsa. Muat ulang halaman dan coba lagi.';
    } else {
        // ---- kumpulkan input ----
        $terisi = [
            'nama_toko'       => cleanStr($_POST['nama_toko'] ?? ''),
            'tagline'         => cleanStr($_POST['tagline'] ?? ''),
            'deskripsi'       => cleanStr($_POST['deskripsi'] ?? ''),
            'whatsapp'        => cleanStr($_POST['whatsapp'] ?? ''),
            'alamat_toko'     => cleanStr($_POST['alamat_toko'] ?? ''),
            'jam_operasional' => cleanStr($_POST['jam_operasional'] ?? ''),
            'announcement'    => cleanStr($_POST['announcement'] ?? ''),
            'github_url'      => cleanStr($_POST['github_url'] ?? ''),
            'kategori'        => [],
            'produk'          => [],
        ];

        $kategori = array_values(array_unique(array_filter(
            array_map('trim', preg_split('/[\r\n,]+/', cleanStr($_POST['kategori_daftar'] ?? '')) ?: []),
            static function (string $k): bool { return $k !== ''; }
        )));

        $namaBaris      = (array) ($_POST['produk_nama'] ?? []);
        $hargaBaris     = (array) ($_POST['produk_harga'] ?? []);
        $katBaris       = (array) ($_POST['produk_kategori'] ?? []);
        $deskripsiBaris = (array) ($_POST['produk_deskripsi'] ?? []);

        $produk = [];
        foreach ($namaBaris as $i => $nama) {
            $produk[] = [
                'nama'      => cleanStr((string) $nama),
                'harga'     => cleanStr((string) ($hargaBaris[$i] ?? '')),
                'kategori'  => cleanStr((string) ($katBaris[$i] ?? '')),
                'deskripsi' => cleanStr((string) ($deskripsiBaris[$i] ?? '')),
            ];
        }
        $produk = array_values(array_filter($produk, static function (array $p): bool {
            return $p['nama'] !== '' || $p['harga'] !== '' || $p['kategori'] !== '' || $p['deskripsi'] !== '';
        }));

        $terisi['kategori'] = $kategori;
        $terisi['produk']   = $produk;

        // ---- validasi ----
        if ($terisi['nama_toko'] === '') {
            $errors[] = 'Nama toko wajib diisi.';
        }
        if ($terisi['whatsapp'] !== '' && !preg_match('/^\+\d{7,15}$/', $terisi['whatsapp'])) {
            $errors[] = 'Nomor WhatsApp harus format internasional, contoh: +6281234567890 (boleh dibiarkan kosong).';
        }
        foreach ($produk as $i => $p) {
            if ($p['nama'] === '') {
                $errors[] = 'Nama produk baris ke-' . ($i + 1) . ' belum diisi.';
            }
            if ($p['harga'] === '') {
                $errors[] = 'Harga produk baris ke-' . ($i + 1) . ' belum diisi.';
            }
        }
        if ($terisi['github_url'] !== '') {
            $url = filter_var($terisi['github_url'], FILTER_VALIDATE_URL);
            if ($url === false || stripos((string) $url, '://') === false) {
                $errors[] = 'URL Repo GitHub target tidak valid (boleh dikosongkan untuk skip push).';
            } else {
                $terisi['github_url'] = (string) $url;
            }
        }

        // ---- siapkan folder toko baru ----
        $slug      = slugify($terisi['nama_toko']);
        $storeRoot = rtrim($StoreBaseDir, '/\\') . DIRECTORY_SEPARATOR . $slug;
        $dataDir   = $storeRoot . DIRECTORY_SEPARATOR . 'data';
        $imagesDir = $storeRoot . DIRECTORY_SEPARATOR . 'images';
        $adminDir  = $storeRoot . DIRECTORY_SEPARATOR . 'admin';

        if (!$errors && file_exists($storeRoot)) {
            $errors[] = 'Folder toko sudah ada: ' . $storeRoot . ' — hapus/rename dulu atau gunakan nama toko lain.';
        }

        if (!$errors) {
            foreach ([$storeRoot, $dataDir, $imagesDir, $adminDir] as $dir) {
                $err = buatDir($dir);
                if ($err !== null) {
                    $errors[] = $err;
                    break;
                }
            }
        }

        // ---- salin templat master ----
        if (!$errors) {
            $err = salinFile($TemplateWebDir . DIRECTORY_SEPARATOR . 'index.html', $storeRoot . DIRECTORY_SEPARATOR . 'index.html');
            if ($err !== null) {
                $errors[] = $err;
            }
        }
        if (!$errors) {
            $err = salinFile($TemplateWebDir . DIRECTORY_SEPARATOR . 'admin' . DIRECTORY_SEPARATOR . 'index.html', $adminDir . DIRECTORY_SEPARATOR . 'index.html');
            if ($err !== null) {
                $errors[] = $err;
            }
        }

        // ---- unggah gambar ----
        $fotoToko = '';
        $qris     = '';
        $gambar   = [];

        if (!$errors) {
            $hasil = simpanGambar($_FILES['gambar_toko'] ?? [], $imagesDir, 'toko', $AllowedMime, $MaxUploadBytes);
            if (!$hasil['ok']) {
                $errors[] = 'Foto toko: ' . $hasil['error'];
            } else {
                $fotoToko = (string) $hasil['path'];
            }
        }
        if (!$errors) {
            $hasil = simpanGambar($_FILES['qris'] ?? [], $imagesDir, 'qris', $AllowedMime, $MaxUploadBytes);
            if (!$hasil['ok']) {
                $errors[] = 'QRIS: ' . $hasil['error'];
            } else {
                $qris = (string) $hasil['path'];
            }
        }
        $berkasProduk = $_FILES['produk_gambar'] ?? null;
        foreach ($produk as $i => $p) {
            $entri = [
                'name'     => $berkasProduk['name'][$i] ?? '',
                'type'     => $berkasProduk['type'][$i] ?? '',
                'tmp_name' => $berkasProduk['tmp_name'][$i] ?? '',
                'error'    => (int) ($berkasProduk['error'][$i] ?? UPLOAD_ERR_NO_FILE),
                'size'     => (int) ($berkasProduk['size'][$i] ?? 0),
            ];
            $hasil = simpanGambar($entri, $imagesDir, 'produk', $AllowedMime, $MaxUploadBytes);
            if (!$hasil['ok']) {
                $errors[] = 'Foto produk "' . $p['nama'] . '": ' . $hasil['error'];
                break;
            }
            $gambar[$i] = (string) $hasil['path'];
        }

        // ---- tulis data + berkas pendukung ----
        if (!$errors) {
            $storeJson = [
                'nama_toko'       => $terisi['nama_toko'],
                'tagline'         => $terisi['tagline'],
                'deskripsi'       => $terisi['deskripsi'],
                'whatsapp'        => $terisi['whatsapp'],
                'email'           => '',
                'instagram'       => '',
                'instagram_handle'=> '',
                'alamat_toko'     => $terisi['alamat_toko'],
                'jam_operasional' => $terisi['jam_operasional'],
                'foto_toko'       => $fotoToko,
                'announcement'    => $terisi['announcement'],
                'qris'            => $qris,
                'kategori'        => $kategori,
            ];

            $items = [];
            foreach ($produk as $i => $p) {
                $items[] = [
                    'id'        => 'p' . ($i + 1),
                    'nama'      => $p['nama'],
                    'kategori'  => $p['kategori'],
                    'harga'     => formatRupiah($p['harga']),
                    'stok'      => 10,
                    'unit'      => 'unit',
                    'gambar'    => $gambar[$i] ?? '',
                    'deskripsi' => $p['deskripsi'],
                ];
            }

            $pembentuk = [
                tulisFile($dataDir . DIRECTORY_SEPARATOR . 'store_info.json',
                    json_encode($storeJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL),
                tulisFile($dataDir . DIRECTORY_SEPARATOR . 'products.json',
                    json_encode(['items' => $items], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL),
                tulisFile($storeRoot . DIRECTORY_SEPARATOR . '.gitignore',
                    ".DS_Store\nnode_modules/\n.env\n*.log\n"),
                tulisFile($storeRoot . DIRECTORY_SEPARATOR . 'netlify.toml',
                    "# Situs statis MyToko: root folder toko sebagai publish dir\n[build]\n  publish = \".\"\n"),
                tulisFile($adminDir . DIRECTORY_SEPARATOR . 'config.yml', konfigurasiDecap()),
            ];
            foreach ($pembentuk as $err) {
                if ($err !== null) {
                    $errors[] = $err;
                }
            }

            if (!$errors) {
                $feedback[] = 'Struktur toko berhasil dibuat di: <code>' . escapeHtml($storeRoot) . '</code>';
                $feedback[] = 'File <code>data/store_info.json</code> dan <code>data/products.json</code> berhasil digenerate.';
                $feedback[] = (count($items)) . ' produk & ' . count($kategori) . ' kategori disimpan.';

                // ---- git: init => add => commit => branch -M main => push -u origin main ----
                $cek = jalankanPerintah($storeRoot, 'git --version');
                if (!$cek['ok']) {
                    $gitLog[] = 'GIT: CLI tidak tersedia — lewati otomatisasi (commit/push manual).';
                } else {
                    $gitLog[] = 'GIT: ' . $cek['out'];

                    $r = jalankanPerintah($storeRoot, 'git init');
                    $gitLog[] = $r['ok'] ? 'OK: git init' : 'GAGAL git init: ' . $r['out'];

                    if ($terisi['github_url'] !== '') {
                        jalankanPerintah($storeRoot, 'git remote remove origin');
                        $r = jalankanPerintah($storeRoot, 'git remote add origin ' . escapeshellarg($terisi['github_url']));
                        $gitLog[] = $r['ok'] ? 'OK: remote origin -> ' . $terisi['github_url'] : 'GAGAL set remote: ' . $r['out'];
                    }

                    $r = jalankanPerintah($storeRoot, 'git add .');
                    $gitLog[] = $r['ok'] ? 'OK: git add .' : 'GAGAL git add: ' . $r['out'];

                    $pesan = 'Initial setup for ' . $terisi['nama_toko'] . ' via setup.php';
                    $r = jalankanPerintah($storeRoot, 'git commit -m ' . escapeshellarg('Initial setup for ' . $terisi['nama_toko'] . ' via setup.php'));
                    if ($r['ok']) {
                        $gitLog[] = 'OK: git commit';
                    } elseif (stripos($r['out'], 'nothing to commit') !== false) {
                        $gitLog[] = 'CATATAN: tidak ada perubahan untuk dikomit (' . $pesan . ')';
                    } else {
                        $gitLog[] = 'GAGAL git commit: ' . $r['out'];
                    }

                    $r = jalankanPerintah($storeRoot, 'git branch -M main');
                    $gitLog[] = $r['ok'] ? 'OK: git branch -M main' : 'GAGAL git branch: ' . $r['out'];

                    if ($terisi['github_url'] !== '') {
                        $r = jalankanPerintah($storeRoot, 'git push -u origin main');
                        if ($r['ok']) {
                            $gitLog[] = 'OK: git push -u origin main';
                        } else {
                            $gitLog[] = 'GAGAL git push: ' . $r['out'];
                            $gitLog[] = 'Coba manual dari folder toko: <code>git push -u origin main</code>'
                                      . ' (pastikan SSH/PAT sudah dikonfigurasi).';
                        }
                    } else {
                        $gitLog[] = 'SKIP: git push dilewati (URL repo GitHub tidak diisi).';
                    }
                }
            }
        }

        // bersihkan folder toko yang gagal dibuat sebagian
        if ($errors && isset($storeRoot) && file_exists($storeRoot)) {
            hapusRekursif($storeRoot);
            $errors[] = 'Folder toko yang gagal telah dihapus otomatis.';
        }
    }
}

/* Konfigurasi Decap CMS yang disalin ke folder toko baru (path relatif toko).
   Kolomnya sengaja sama persis dengan template agar tidak ada perbedaan perilaku. */
function konfigurasiDecap(): string
{
    return <<<'YAML'
backend:
  name: git-gateway
  branch: main

locale: "id"

media_folder: "images"
public_folder: "/images"

collections:
  - name: "produk"
    label: "Produk"
    label_singular: "Produk"
    files:
      - file: "data/products.json"
        label: "Daftar Produk"
        name: "produk"
        description: "Kelola kumpulan produk katalog (tambah / edit / hapus)."
        fields:
          - label: "Kumpulan Produk"
            name: "items"
            widget: "list"
            allow_add: true
            collapsed: false
            label_singular: "Produk"
            summary: "{{fields.nama}} - {{fields.harga}}"
            fields:
              - { label: "ID", name: "id", widget: "string", required: false, hint: "Kosongkan; terisi otomatis." }
              - { label: "Nama Produk", name: "nama", widget: "string" }
              - { label: "Kategori", name: "kategori", widget: "string", hint: "Ketik nama kategori. Daftar lengkap dikelola di Pengaturan Toko." }
              - { label: "Harga", name: "harga", widget: "string", pattern: ["^Rp[0-9.]+$", "Format harga harus diawali Rp, contoh: Rp46.000"], hint: "Contoh: Rp46.000" }
              - { label: "Stok", name: "stok", widget: "number", value_type: "int", default: 10, min: 0 }
              - { label: "Satuan", name: "unit", widget: "string", default: "unit" }
              - { label: "Foto Produk", name: "gambar", widget: "image", allow_multiple: false }
              - { label: "Deskripsi (opsional)", name: "deskripsi", widget: "text", required: false }

  - name: "pengaturan_bisnis"
    label: "Pengaturan Toko"
    files:
      - file: "data/store_info.json"
        label: "Pengaturan Toko"
        name: "pengaturan"
        description: "Identitas toko, promo, kontak, dan daftar kategori yang tampil di seluruh halaman katalog."
        fields:
          - { label: "Nama Toko", name: "nama_toko", widget: "string", default: "MyToko" }
          - { label: "Tagline", name: "tagline", widget: "string", required: false }
          - { label: "Deskripsi Toko", name: "deskripsi", widget: "text", required: false, hint: "Tampil di halaman Tentang" }
          - { label: "Nomor WhatsApp", name: "whatsapp", widget: "string", default: "+6281234567890", hint: "Gunakan format internasional, mis. +6281234567890" }
          - { label: "Email", name: "email", widget: "string", required: false }
          - { label: "Instagram (URL)", name: "instagram", widget: "string", required: false }
          - { label: "Handle Instagram", name: "instagram_handle", widget: "string", required: false, hint: "Contoh: @mytoko.example" }
          - { label: "Alamat Toko", name: "alamat_toko", widget: "text", required: false }
          - { label: "Jam Operasional", name: "jam_operasional", widget: "string", required: false }
          - {
              label: "Kategori Produk",
              name: "kategori",
              widget: "list",
              allow_add: true,
              label_singular: "Kategori",
              hint: "Daftar kategori yang dipilih produk. Tambah / ubah / hapus kategori di sini."
            }
          - { label: "Foto Toko", name: "foto_toko", widget: "image", required: false, hint: "Foto fisik toko untuk halaman Tentang" }
          - { label: "Banner Promo", name: "announcement", widget: "text", required: false, hint: "Teks pengumuman/promo di atas hero" }
          - { label: "Gambar QRIS", name: "qris", widget: "image", required: false, hint: "Kode QRIS untuk pembayaran di halaman keranjang" }
YAML;
}

$daftarKategoriText = renderDaftarKategori($terisi['kategori']);
$barisProdukAwal    = $terisi['produk'] ?: [[]];
?>
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Toko Baru | MyToko</title>
  <style>
    :root {
      --ink: #20242b;
      --muted: #6d747e;
      --line: #e2e5e9;
      --paper: #ffffff;
      --canvas: #f4f6f8;
      --accent: #6d3f2c;
      --accent-dark: #4d2a1e;
      --success: #176b45;
      --success-bg: #e6f5ec;
      --danger: #a33b35;
      --danger-bg: #fff0ef;
      --shadow: 0 18px 45px rgba(32, 36, 43, .08);
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--canvas); font: 15px/1.5 Georgia, 'Times New Roman', serif; }
    button, input, textarea, select { font: inherit; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 42px 0 64px; }
    .masthead { display: flex; justify-content: space-between; gap: 24px; align-items: end; margin-bottom: 28px; }
    .eyebrow { margin: 0 0 7px; color: var(--accent); font: 700 12px/1.2 Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { max-width: 720px; margin-bottom: 8px; font-size: clamp(2rem, 4.5vw, 3.4rem); line-height: 1.05; letter-spacing: -.045em; font-weight: 700; }
    h2 { margin-bottom: 6px; font-size: 1.55rem; letter-spacing: -.025em; }
    .intro { max-width: 680px; margin-bottom: 0; color: var(--muted); font-size: 1.02rem; }
    .path-note { color: var(--muted); font: 12px/1.4 Arial, sans-serif; text-align: right; }
    .notice { margin: 0 0 22px; padding: 13px 16px; border-radius: 10px; font-family: Arial, sans-serif; }
    .notice.success { color: var(--success); background: var(--success-bg); border: 1px solid #b8e3ca; }
    .notice.error { color: var(--danger); background: var(--danger-bg); border: 1px solid #f0c5c1; }
    .notice code, .log code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; }
    .log { margin: 10px 0 0; padding: 13px 15px; background: #fafafa; border: 1px solid var(--line); border-radius: 9px; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
    .layout { display: grid; grid-template-columns: minmax(290px, .72fr) minmax(0, 1.28fr); gap: 22px; align-items: start; }
    .panel { padding: 26px; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 20px; }
    .hint { color: var(--muted); font: 12px/1.45 Arial, sans-serif; }
    .field { margin-bottom: 16px; }
    .field.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    label { display: block; margin-bottom: 6px; color: #4e555e; font: 700 12px Arial, sans-serif; letter-spacing: .04em; text-transform: uppercase; }
    input, textarea, select { width: 100%; padding: 11px 12px; color: var(--ink); background: #fbfcfd; border: 1px solid #cfd4da; border-radius: 8px; outline: 0; }
    input:focus, textarea:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(109, 63, 44, .13); }
    textarea { min-height: 84px; resize: vertical; }
    input[type=file] { padding: 8px; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 20px; }
    button { padding: 10px 15px; color: #fff; background: var(--accent); border: 0; border-radius: 7px; cursor: pointer; font: 700 13px Arial, sans-serif; }
    button:hover { background: var(--accent-dark); }
    button.secondary { color: var(--accent); background: #f2ebe7; }
    .produk-list { display: grid; gap: 14px; }
    .row-produk { padding: 17px; border: 1px solid var(--line); border-radius: 10px; background: #fcfcfb; }
    .product-grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 12px; }
    .product-grid .wide { grid-column: span 2; }
    .row-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    .divider { margin: 26px 0 22px; border: 0; border-top: 1px solid var(--line); }
    @media (max-width: 800px) {
      .masthead { display: block; }
      .path-note { margin-top: 14px; text-align: left; }
      .layout { grid-template-columns: 1fr; }
      .field.cols { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .shell { width: min(100% - 22px, 1180px); padding-top: 26px; }
      .panel { padding: 19px; }
      .product-grid { grid-template-columns: 1fr; }
      .product-grid .wide { grid-column: auto; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">Setup offline</p>
        <h1>Buat toko baru dari template master.</h1>
        <p class="intro">Isi identitas, kategori, dan produk awal. Gambar disimpan ke <strong>images/</strong>,
          data digenerate ke <strong>data/</strong>, lalu <code>index.html</code> + <code>admin/</code> disalin dari master.
          Terakhir, skrip mengcommit &amp; mendorong ke GitHub (bila URL repo diisi).</p>
      </div>
      <p class="path-note"><?= escapeHtml(rtrim($StoreBaseDir, '/\\')) ?>/&lt;nama-toko&gt;<br>index.html · admin/ · data/ · images/</p>
    </header>

    <?php foreach ($feedback as $fb): ?>
      <div class="notice success" role="status"><?= $fb ?></div>
    <?php endforeach; ?>
    <?php foreach ($errors as $error): ?>
      <div class="notice error" role="alert"><?= escapeHtml($error) ?></div>
    <?php endforeach; ?>

    <form method="post" enctype="multipart/form-data">
      <input type="hidden" name="action" value="run_setup">
      <input type="hidden" name="_token" value="<?= escapeHtml((string) ($_SESSION['mytoko_csrf'] ?? '')) ?>">

      <div class="layout">
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">1</p>
              <h2>Informasi toko</h2>
            </div>
          </div>

          <div class="field">
            <label for="nama_toko">Nama Toko</label>
            <input id="nama_toko" name="nama_toko" type="text" value="<?= escapeHtml($terisi['nama_toko']) ?>" required placeholder="Contoh: Toko Kue Bu Sari">
            <p class="hint">Nama menentukan nama folder toko baru, misal <code>stores/toko-kue-bu-sari</code>.</p>
          </div>
          <div class="field">
            <label for="tagline">Tagline (opsional)</label>
            <input id="tagline" name="tagline" type="text" value="<?= escapeHtml($terisi['tagline']) ?>" placeholder="Belanja mudah, pesan langsung via WhatsApp">
          </div>
          <div class="field">
            <label for="deskripsi">Deskripsi Toko</label>
            <textarea id="deskripsi" name="deskripsi" placeholder="Ceritakan singkat tentang toko Anda."><?= escapeHtml($terisi['deskripsi']) ?></textarea>
          </div>
          <div class="field cols">
            <div>
              <label for="whatsapp">Nomor WhatsApp</label>
              <input id="whatsapp" name="whatsapp" type="text" value="<?= escapeHtml($terisi['whatsapp']) ?>" placeholder="+6281234567890">
            </div>
            <div>
              <label for="jam_operasional">Jam Operasional</label>
              <input id="jam_operasional" name="jam_operasional" type="text" value="<?= escapeHtml($terisi['jam_operasional']) ?>" placeholder="Senin–Minggu 08.00–18.00">
            </div>
          </div>
          <div class="field">
            <label for="alamat_toko">Alamat Toko</label>
            <textarea id="alamat_toko" name="alamat_toko" placeholder="Alamat lengkap toko."><?= escapeHtml($terisi['alamat_toko']) ?></textarea>
          </div>
          <div class="field">
            <label for="announcement">Banner Promo (opsional)</label>
            <textarea id="announcement" name="announcement" rows="2" placeholder="Promo..."><?= escapeHtml($terisi['announcement']) ?></textarea>
          </div>
          <div class="field cols">
            <div>
              <label for="gambar_toko">Upload Foto Toko (opsional)</label>
              <input id="gambar_toko" name="gambar_toko" type="file" accept="image/*">
            </div>
            <div>
              <label for="qris">Upload Gambar QRIS (opsional)</label>
              <input id="qris" name="qris" type="file" accept="image/*">
            </div>
          </div>
          <p class="hint">Gambar maksimal 3 MB (JPG/PNG/GIF/WebP) dan disimpan sebagai path relatif <code>images/&lt;nama&gt;</code>.</p>

          <hr class="divider">

          <div class="field">
            <label for="github_url">URL Repo GitHub target (opsional)</label>
            <input id="github_url" name="github_url" type="url" value="<?= escapeHtml($terisi['github_url']) ?>" placeholder="https://github.com/akun/nama-repo">
            <p class="hint">Jika diisi, skrip otomatis <code>git init</code> di folder toko lalu <code>git push -u origin main</code>.
              Kosongkan untuk hanya membuat struktur + commit lokal. Jangan gunakan repo ini (MyToko) untuk menghindari repo bersarang.</p>
          </div>
        </div>

        <div>
          <section class="panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">2</p>
                <h2>Kategori produk</h2>
              </div>
            </div>
            <div class="field">
              <label for="kategori_daftar">Daftar Kategori</label>
              <textarea id="kategori_daftar" name="kategori_daftar" rows="4" required
                placeholder="Satu kategori per baris atau pisahkan dengan koma.&#10;Contoh:&#10;Kue Kering&#10;Donat, Minuman"><?= escapeHtml($daftarKategoriText) ?></textarea>
              <p class="hint">Disimpan sebagai array <code>kategori</code> di <code>data/store_info.json</code> dan bisa diubah
                pemilik toko lewat dashboard admin (Pengaturan Toko → Kategori Produk).</p>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">3</p>
                <h2>Produk awal</h2>
              </div>
              <button type="button" class="secondary" id="tambah-produk">+ Tambah produk</button>
            </div>
            <div class="produk-list" id="daftar-produk">
              <?php foreach ($barisProdukAwal as $i => $baris): ?>
                <?= renderBarisProduk($baris, $terisi['kategori'] ?: ['Kue Kering', 'Donat', 'Minuman'], $i, true) ?>
              <?php endforeach; ?>
            </div>
            <p class="hint" id="catatan-berkas">Bila pengiriman gagal validasi, berkas gambar produk harus dipilih ulang.</p>
            <hr class="divider">
            <div class="actions">
              <button type="submit">Buat toko &amp; jalankan Git</button>
            </div>
          </section>

          <?php if ($gitLog): ?>
            <section class="panel">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Git</p>
                  <h2>Hasil otomatisasi</h2>
                </div>
              </div>
              <div class="log"><?php foreach ($gitLog as $barisLog): ?><?= escapeHtml($barisLog) ?><?= PHP_EOL ?><?php endforeach; ?></div>
            </section>
          <?php endif; ?>
        </div>
      </div>
    </form>
  </main>

  <template id="template-produk">
    <?= renderBarisProduk([], [], 0, true) ?>
  </template>

  <script>
    (function () {
      'use strict';

      var txtArea = document.getElementById('kategori_daftar');
      var daftar  = document.getElementById('daftar-produk');
      var template = document.getElementById('template-produk');

      function ambilKategori() {
        return txtArea.value
          .split(/[\r\n,]+/)
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
      }

      function isiSelect(select, pilihan) {
        var nilai = select.value;
        select.innerHTML = '<option value="">Pilih kategori</option>';
        pilihan.forEach(function (kat) {
          var o = document.createElement('option');
          o.value = kat;
          o.textContent = kat;
          select.appendChild(o);
        });
        if (pilihan.indexOf(nilai) !== -1) select.value = nilai;
      }

      function sinkronkanKategori() {
        var pilihan = ambilKategori();
        daftar.querySelectorAll('select.produk-kategori').forEach(function (sel) {
          isiSelect(sel, pilihan);
        });
      }

      function tambahBaris() {
        var frag = template.content.cloneNode(true);
        daftar.appendChild(frag);
        sinkronkanKategori();
        var baris = daftar.lastElementChild;
        var field = baris.querySelector('input[name="produk_nama[]"]');
        if (field) field.focus();
      }

      daftar.addEventListener('click', function (e) {
        if (e.target.classList.contains('hapus-baris')) {
          var baris = e.target.closest('.row-produk');
          if (baris) {
            if (daftar.children.length === 1) {
              daftar.innerHTML = '';
              tambahBaris();
            } else {
              baris.remove();
            }
          }
        }
      });

      document.getElementById('tambah-produk').addEventListener('click', tambahBaris);
      txtArea.addEventListener('input', sinkronkanKategori);
      sinkronkanKategori();
    })();
  </script>
</body>
</html>