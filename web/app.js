/* =====================================================================
   MyToko — Mesin Katalog (Centralized / CDN)
   Repo master : github.com/getmytoko/katalog-umkm  (via jsDelivr)
   Dipakai   : index.html klien, HANYA berisi <div id="app"></div>

   Data spesifik toko dibaca RELATIF dari repo klien:
     ./data/store_info.json   -> identitas toko, promo, WhatsApp, QRIS
     ./data/products.json     -> daftar produk

   Seluruh UI digambar dari sini (SPA berbasis hash):
     #/            Beranda  (hero, promo, pencarian, kategori, grid produk)
     #/cari?q=…    Hasil pencarian langsung (live search)
     #/produk/:id  Modal detail produk
     #/keranjang   Halaman keranjang + form checkout WhatsApp
     #/tentang     Halaman tentang toko
   ===================================================================== */
(function (window, document) {
  "use strict";

  /* =========================================================
     1) KONSTANTA & STATE GLOBAL
     ========================================================= */
  var VERSION = "1.0.0";
  var LS_KERANJANG = "mytoko_keranjang";
  var LS_TEMA = "mytoko_tema";
  var BERANDA = "Beranda";

  var DEFAULT_TOKO = {
    nama_toko: "MyToko",
    tagline: "Belanja mudah, pesan langsung via WhatsApp",
    deskripsi: "",
    whatsapp: "+6281234567890",
    alamat_toko: "",
    jam_operasional: "",
    foto_toko: "",
    announcement: "",
    qris: "",
    email: "",
    instagram: "",
    instagram_handle: ""
  };

  var state = {
    toko: null,
    produk: [],
    kategori: [BERANDA],
    kategoriAktif: BERANDA,
    cari: "",
    urutan: "default",
    keranjang: {},
    formCache: {},
    tema: "light",
    produkAktif: null, // index produk yang sedang dibuka di modal
    modalQty: 1,
    siap: false
  };

  /* =========================================================
     2) HELPER DASAR
     ========================================================= */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function rupiah(angka) {
    return "Rp " + Number(angka || 0).toLocaleString("id-ID");
  }

  function hargaAngka(h) {
    if (typeof h === "number") return h;
    return parseFloat(String(h == null ? "" : h).replace(/[^\d]/g, "")) || 0;
  }

  function nomorWa(no) {
    if (!no) return "";
    var bersih = String(no).replace(/[^\d]/g, "");
    if (bersih.indexOf("0") === 0) bersih = "62" + bersih.slice(1);
    return bersih;
  }

  function stokProduk(p) {
    var s = parseInt(p.stok, 10);
    return isNaN(s) ? 0 : s;
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(null, args);
      }, ms || 250);
    };
  }

  /* =========================================================
     3) MUAT & JAGA DATA LOKAL TOKO
     ========================================================= */
  function muatJson(jalur) {
    return fetch(jalur, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.warn("[MyToko] Gagal memuat " + jalur + ":", err.message);
        return null;
      });
  }

  function dapatkanKategori() {
    var list = [];
    var dariToko =
      state.toko && Array.isArray(state.toko.kategori)
        ? state.toko.kategori.filter(function (k) { return !!k; })
        : [];
    if (dariToko.length) {
      list = dariToko.slice();
    } else {
      state.produk.forEach(function (p) {
        if (p.kategori && list.indexOf(p.kategori) === -1) list.push(p.kategori);
      });
    }
    return [BERANDA].concat(list.filter(function (k) { return k !== BERANDA; }));
  }

  async function muatData() {
    var info = await muatJson("./data/store_info.json");
    var data = await muatJson("./data/products.json");
    state.toko = Object.assign({}, DEFAULT_TOKO, info || {});
    state.produk = data && Array.isArray(data.items) ? data.items : [];
    state.kategori = dapatkanKategori();
  }

  /* =========================================================
     4) TEMA (GELAP / TERANG)
     ========================================================= */
  function terapkanTema() {
    document.documentElement.classList.toggle("dark", state.tema === "dark");
    try {
      localStorage.setItem(LS_TEMA, state.tema);
    } catch (e) { /* abaikan */ }
    var btn = $("#tombolTema");
    if (btn) {
      btn.innerHTML =
        state.tema === "dark"
          ? '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>'
          : '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
    }
  }

  function toggleTema() {
    state.tema = state.tema === "dark" ? "light" : "dark";
    terapkanTema();
  }

  function inisialisasiTema() {
    var tersimpan = null;
    try {
      tersimpan = localStorage.getItem(LS_TEMA);
    } catch (e) { /* abaikan */ }
    if (tersimpan === "light" || tersimpan === "dark") {
      state.tema = tersimpan;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      state.tema = "dark";
    }
    terapkanTema();
  }

  /* =========================================================
     5) KERANJANG (localStorage)
     ========================================================= */
  function isiKeranjang() {
    try {
      state.keranjang = JSON.parse(localStorage.getItem(LS_KERANJANG)) || {};
    } catch (e) {
      state.keranjang = {};
    }
  }

  function simpanKeranjang() {
    try {
      localStorage.setItem(LS_KERANJANG, JSON.stringify(state.keranjang));
    } catch (e) { /* abaikan */ }
  }

  function jumlahKeranjang() {
    return Object.keys(state.keranjang).reduce(function (a, k) {
      return a + state.keranjang[k];
    }, 0);
  }

  function totalKeranjang() {
    var total = 0;
    Object.keys(state.keranjang).forEach(function (k) {
      var idx = parseInt(k, 10);
      var p = state.produk[idx];
      if (p) total += hargaAngka(p.harga) * state.keranjang[k];
    });
    return total;
  }

  function tambahKeranjang(idx, qty, senyap) {
    var p = state.produk[idx];
    if (!p) return;
    qty = qty || 1;
    var sisa = stokProduk(p);
    var kini = state.keranjang[idx] || 0;
    var baru = kini + qty;
    if (sisa > 0 && baru > sisa) {
      baru = sisa;
      toast("Stok " + p.nama + " hanya tersisa " + sisa, "peringatan");
    } else if (sisa <= 0) {
      toast("Maaf, " + p.nama + " sedang habis", "peringatan");
      return;
    }
    state.keranjang[idx] = baru;
    simpanKeranjang();
    perbaruiBadgeKeranjang();
    if (ruteSekarang().nama === "keranjang") muatHalaman();
    if (!senyap) toast(p.nama + " masuk keranjang", "sukses");
  }

  function ubahKuantitas(idx, delta) {
    var p = state.produk[idx];
    if (!p) return;
    var kini = (state.keranjang[idx] || 0) + delta;
    if (kini <= 0) {
      hapusKeranjang(idx);
      return;
    }
    var sisa = stokProduk(p);
    if (sisa > 0 && kini > sisa) kini = sisa;
    state.keranjang[idx] = kini;
    simpanKeranjang();
    perbaruiBadgeKeranjang();
    if (ruteSekarang().nama === "keranjang") muatHalaman();
  }

  function hapusKeranjang(idx) {
    delete state.keranjang[idx];
    simpanKeranjang();
    perbaruiBadgeKeranjang();
    toast("Produk dihapus dari keranjang", "info");
    if (ruteSekarang().nama === "keranjang") muatHalaman();
  }

  function perbaruiBadgeKeranjang() {
    var badge = $("#badgeKeranjang");
    if (!badge) return;
    var n = jumlahKeranjang();
    if (n > 0) {
      badge.textContent = n > 99 ? "99+" : n;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  /* =========================================================
     6) ROUTER SPA (hash)
     ========================================================= */
  function ruteSekarang() {
    var raw = (window.location.hash || "#/").replace(/^#/, "");
    var tanpaQuery = raw.split("?")[0].replace(/^\/+/, "");
    var segmen = tanpaQuery.split("/").filter(Boolean);
    var query = new URLSearchParams((raw.split("?")[1] || ""));
    if (segmen[0] === "keranjang") return { nama: "keranjang" };
    if (segmen[0] === "tentang") return { nama: "tentang" };
    if (segmen[0] === "produk") return { nama: "produk", id: parseInt(segmen[1], 10) };
    if (segmen[0] === "cari") return { nama: "cari", q: query.get("q") || "" };
    return { nama: "beranda" };
  }

  function muatHalaman() {
    var rute = ruteSekarang();
    var pindahHalaman =
      !state.ruteLama ||
      state.ruteLama.nama !== rute.nama ||
      state.ruteLama.id !== rute.id ||
      state.ruteLama.q !== rute.q;
    state.ruteLama = rute;

    if (rute.nama === "produk") {
      if (!state.siap) return;
      if (!state.produk[rute.id]) {
        window.location.hash = "#/";
        return;
      }
      bukaModalProduk(rute.id);
      return;
    }

    tutupModal();
    terapkanTema(); // jaga ikon tema tetap konsisten setelah re-render navbar

    if (rute.nama === "beranda") state.cari = "";
    if (rute.nama === "cari") state.cari = rute.q || "";

    var html = "";
    if (rute.nama === "beranda") html = htmlBeranda(false);
    if (rute.nama === "cari") html = htmlBeranda(true);
    if (rute.nama === "keranjang") html = htmlKeranjang();
    if (rute.nama === "tentang") html = htmlTentang();

    var main = $("#app-main");
    if (main) main.innerHTML = html;
    renderKategori();
    renderProduk();
    renderNavbar();

    if (pindahHalaman) window.scrollTo(0, 0);
  }

  /* =========================================================
     7) RENDER BINGKAI (navbar + footer + lapisan modal)
     ========================================================= */
  function renderBingkai() {
    var app = $("#app");
    app.innerHTML =
      '<header id="app-navbar" class="sticky top-0 z-40"></header>' +
      '<main id="app-main" class="flex-1 w-full"></main>' +
      '<footer id="app-footer"></footer>' +
      '<div id="app-modal" class="app-modal" role="dialog" aria-modal="true" aria-hidden="true">' +
      '  <div class="modal-overlay" data-action="tutup-modal"></div>' +
      '  <div id="modal-panel" class="modal-panel"></div>' +
      "</div>" +
      '<div id="app-toast" class="app-toast" aria-live="polite"></div>' +
      '<button id="scrollTop" class="scroll-top-btn" data-action="scroll-top" aria-label="Kembali ke atas">' +
      '  <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>' +
      "</button>";
    renderNavbar();
    renderFooter();
  }

  function renderNavbar() {
    var rute = ruteSekarang();
    var nama = esc(state.toko ? state.toko.nama_toko : "MyToko");

    var tautan = function (hash, label, kunci) {
      var aktif = rute.nama === kunci;
      return (
        '<a href="' + hash + '" data-action="nav" class="nav-link' +
        (aktif ? " nav-link-active" : "") + '">' + label + "</a>"
      );
    };

    $("#app-navbar").innerHTML =
      '<div class="border-b border-app bg-app backdrop-blur">' +
      '  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">' +
      '    <a href="#/" data-action="nav" class="flex min-w-0 items-center gap-2.5">' +
      '      <span class="brand-mark">' + (nama.charAt(0) || "M") + "</span>" +
      '      <span class="min-w-0 leading-tight">' +
      '        <span class="block truncate text-sm font-bold sm:text-base">' + nama + "</span>" +
      "      </span>" +
      "    </a>" +
      '    <nav class="hidden items-center gap-1 md:flex" aria-label="Navigasi utama">' +
      tautan("#/", "Beranda", "beranda") +
      tautan("#/tentang", "Tentang", "tentang") +
      tautan("#/keranjang", "Keranjang", "keranjang") +
      "    </nav>" +
      '    <div class="flex items-center gap-1">' +
      '      <button id="tombolTema" class="icon-btn" data-action="toggle-tema" aria-label="Ganti tema gelap/terang"></button>' +
      '      <a href="#/keranjang" data-action="nav" class="icon-btn" aria-label="Buka keranjang">' +
      '        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
      '        <span id="badgeKeranjang" class="cart-badge hidden">0</span>' +
      "      </a>" +
      '      <button class="icon-btn md:hidden" data-action="toggle-menu" aria-label="Menu navigasi">' +
      '        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
      "      </button>" +
      "    </div>" +
      "  </div>" +
      '  <div id="nav-mobile" class="scrollbar-none hidden overflow-x-auto border-t border-app px-4 py-2 md:hidden">' +
      '    <div class="flex gap-2">' +
      tautan("#/", "Beranda", "beranda") +
      tautan("#/tentang", "Tentang", "tentang") +
      tautan("#/keranjang", "Keranjang", "keranjang") +
      "    </div>" +
      "  </div>" +
      "</div>";

    terapkanTema();
    perbaruiBadgeKeranjang();
  }

  function renderFooter() {
    var t = state.toko;
    var nama = esc(t.nama_toko);
    var tahun = new Date().getFullYear();
    $("#app-footer").innerHTML =
      '<footer class="border-t border-app bg-surface">' +
      '  <div class="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-3">' +
      '    <div>' +
      '      <div class="flex items-center gap-2.5">' +
      '        <span class="brand-mark">' + (nama.charAt(0) || "M") + "</span>" +
      '        <span class="font-bold">' + nama + "</span>" +
      "      </div>" +
      '      <p class="mt-3 max-w-xs text-sm leading-relaxed text-muted">' + esc(t.tagline) + "</p>" +
      '      <div class="mt-4 flex gap-2">' +
      (t.instagram
        ? '<a href="' + esc(t.instagram) + '" target="_blank" rel="noopener" class="btn btn-outline" aria-label="Instagram">' +
          '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.5"/></svg> Instagram</a>'
        : "") +
      (t.whatsapp
        ? '<a href="https://wa.me/' + nomorWa(t.whatsapp) + '" target="_blank" rel="noopener" class="btn btn-outline" aria-label="WhatsApp">' +
          '<svg class="h-4 w-4 fill-current" viewBox="0 0 32 32"><path d="M16 2C8.27 2 2 8.24 2 15.94c0 2.8.79 5.42 2.16 7.65L2 30l6.58-2.11a13.94 13.94 0 0 0 7.42 2.1h.01C23.73 29.99 30 23.75 30 16.05 30 8.24 23.73 2 16 2Zm0 25.31h-.01c-2.29 0-4.53-.64-6.48-1.85l-.47-.27-4.01 1.29 1.3-3.9-.3-.48a11.3 11.3 0 0 1-1.75-6.05c0-6.28 5.12-11.38 11.42-11.38 3.05 0 5.92 1.19 8.08 3.35a11.34 11.34 0 0 1 3.35 8.08c0 6.28-5.13 11.21-11.43 11.21Zm6.26-8.5c-.34-.17-2.02-1-2.33-1.11-.31-.11-.54-.17-.76.17-.23.34-.88 1.11-1.08 1.34-.2.23-.4.25-.73.09-.34-.17-1.43-.53-2.72-1.68a10.22 10.22 0 0 1-1.88-2.34c-.2-.34-.02-.53.15-.7.15-.15.34-.4.5-.6.17-.2.23-.34.34-.57.11-.23.06-.42-.03-.6-.09-.17-.76-1.84-1.05-2.52-.27-.66-.55-.57-.76-.58h-.65c-.23 0-.6.09-.91.42-.31.34-1.2 1.17-1.2 2.85 0 1.68 1.23 3.31 1.4 3.54.17.23 2.42 3.69 5.86 5.17.82.35 1.46.56 1.96.72.82.26 1.57.22 2.16.13.66-.09 2.02-.82 2.31-1.62.28-.8.28-1.48.2-1.62-.09-.17-.34-.28-.7-.42Z"/></svg> WhatsApp</a>'
        : "") +
      "      </div>" +
      "    </div>" +
      '    <div>' +
      '      <h3 class="text-sm font-bold uppercase tracking-wide text-muted">Navigasi</h3>' +
      '      <ul class="mt-3 space-y-2 text-sm">' +
      '        <li><a href="#/" data-action="nav" class="text-body-2 transition hover:text-accent">Beranda</a></li>' +
      '        <li><a href="#/tentang" data-action="nav" class="text-body-2 transition hover:text-accent">Tentang</a></li>' +
      '        <li><a href="#/keranjang" data-action="nav" class="text-body-2 transition hover:text-accent">Keranjang</a></li>' +
      "      </ul>" +
      "    </div>" +
      '    <div>' +
      '      <h3 class="text-sm font-bold uppercase tracking-wide text-muted">Hubungi Kami</h3>' +
      '      <ul class="mt-3 space-y-2 text-sm text-body-2">' +
      (t.alamat_toko ? "<li>" + esc(t.alamat_toko) + "</li>" : "") +
      (t.jam_operasional ? "<li>" + esc(t.jam_operasional) + "</li>" : "") +
      (t.email ? '<li><a class="hover:text-accent" href="mailto:' + esc(t.email) + '">' + esc(t.email) + "</a></li>" : "") +
      (t.whatsapp ? "<li><a class=\"hover:text-accent\" href=\"https://wa.me/" + nomorWa(t.whatsapp) + "\">" + esc(t.whatsapp) + "</a></li>" : "") +
      "      </ul>" +
      "    </div>" +
      "  </div>" +
      '  <div class="border-t border-app">' +
      '    <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted sm:flex-row">' +
      "      <span>© " + tahun + " " + nama + ". Hak cipta dilindungi.</span>" +
      '      <span>Ditenagai MyToko Engine v' + VERSION + "</span>" +
      "    </div>" +
      "  </div>" +
      "</footer>";
  }

  /* =========================================================
     8) HALAMAN BERANDA + PENCARIAN
     ========================================================= */
  function htmlBeranda(menampilkanPencarian) {
    var t = state.toko;
    var judul = menampilkanPencarian ? "Hasil pencarian" : "Katalog Produk";
    return (
      (t.announcement
        ? '<div class="border-b border-app bg-accent-soft">' +
          '  <div class="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2.5 text-center text-xs font-medium text-accent sm:text-sm">' +
          '    <span aria-hidden="true">🎉</span><span class="line-clamp-1">' + esc(t.announcement) + "</span>" +
          "  </div>" +
          "</div>"
        : "") +
      '<section class="hero-gradient text-white">' +
      '  <div class="mx-auto max-w-6xl px-4 py-14 text-center sm:py-16">' +
      '    <h1 class="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">' + esc(t.nama_toko) + "</h1>" +
      '    <p class="mx-auto mt-3 max-w-2xl text-sm text-white/85 sm:text-lg">' + esc(t.tagline) + "</p>" +
      '    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">' +
      '      <button class="btn btn-light" data-action="scroll-galeri">Lihat Katalog</button>' +
      '      <a href="#/tentang" data-action="nav" class="btn btn-outline-light">Tentang Kami</a>' +
      "    </div>" +
      "  </div>" +
      "</section>" +
      '<section id="app-galeri" class="mx-auto w-full max-w-6xl px-4 py-10">' +
      '  <div class="flex flex-wrap items-end justify-between gap-3">' +
      '    <div>' +
      '      <h2 id="judulKatalog" class="section-title">' + judul + "</h2>" +
      '      <p id="jumlahProduk" class="mt-1 text-sm text-muted"></p>' +
      "    </div>" +
      '  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">' +
      '    <div class="relative w-full sm:w-72">' +
      '      <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '      <input type="search" data-search value="' + esc(state.cari) + '" placeholder="Cari produk…" autocomplete="off" aria-label="Cari produk" class="input-app pl-10" />' +
      "    </div>" +
      '    <select data-urut aria-label="Urutkan harga" class="input-app w-full cursor-pointer sm:w-auto">' +
      '      <option value="default"' + (state.urutan === "default" ? " selected" : "") + ">Urut: Default</option>" +
      '      <option value="termurah"' + (state.urutan === "termurah" ? " selected" : "") + ">Harga terendah</option>" +
      '      <option value="termahal"' + (state.urutan === "termahal" ? " selected" : "") + ">Harga tertinggi</option>" +
      "    </select>" +
      "    </div>" +
      "  </div>" +
      '  <nav class="scrollbar-none -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 pt-1" aria-label="Filter kategori">' +
      '    <div id="kategoriList" class="flex gap-2"></div>' +
      "  </nav>" +
      '  <section id="produkGrid" class="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-live="polite"></section>' +
      "</section>"
    );
  }

  function renderKategori() {
    var wadah = $("#kategoriList");
    if (!wadah) return;
    wadah.innerHTML = state.kategori
      .map(function (k) {
        var aktif = state.kategoriAktif === k;
        return (
          '<button type="button" data-action="pilih-kategori" data-kategori="' + esc(k) + '" class="chip' +
          (aktif ? " chip-active" : "") + '" aria-pressed="' + aktif + '">' + esc(k) + "</button>"
        );
      })
      .join("");
  }

  function daftarProdukTerfilter() {
    var kata = state.cari.trim().toLowerCase();
    var hasil = state.produk.filter(function (p) {
      var samaKategori = state.kategoriAktif === BERANDA || p.kategori === state.kategoriAktif;
      var teks = (p.nama + " " + (p.kategori || "") + " " + (p.deskripsi || "")).toLowerCase();
      return samaKategori && (!kata || teks.indexOf(kata) !== -1);
    });
    if (state.urutan === "termurah") {
      hasil.sort(function (a, b) { return hargaAngka(a.harga) - hargaAngka(b.harga); });
    } else if (state.urutan === "termahal") {
      hasil.sort(function (a, b) { return hargaAngka(b.harga) - hargaAngka(a.harga); });
    }
    return hasil;
  }

  function renderProduk() {
    var grid = $("#produkGrid");
    var jumlah = $("#jumlahProduk");
    if (!grid) return;
    var daftar = daftarProdukTerfilter();

    if (jumlah) {
      jumlah.textContent =
        "Menampilkan " + daftar.length + " dari " + state.produk.length + " produk";
    }

    if (!daftar.length) {
      grid.innerHTML =
        '<div class="empty-state col-span-full">' +
        '  <span class="text-5xl" aria-hidden="true">🔍</span>' +
        "  <p class=\"font-medium text-body\">Produk tidak ditemukan</p>" +
        '  <p class="text-sm text-muted">Coba kata kunci atau kategori lain.</p>' +
        "</div>";
      return;
    }

    grid.innerHTML = daftar.map(function (p, i) {
      var asli = state.produk.indexOf(p);
      return kartuProdukHTML(p, asli);
    }).join("");
  }

  function lencanaStok(p) {
    var s = stokProduk(p);
    if (s <= 0) return '<span class="badge habis">Habis</span>';
    if (s < 10) return '<span class="badge peringatan">Sisa ' + s + "</span>";
    return "";
  }

  function mediaProduk(p, variasi) {
    var med = '<div class="card-media relative" data-action="detail-produk" data-id="' + variasi.idx + '" role="button" tabindex="0" aria-label="Lihat detail ' + esc(p.nama) + '" style="cursor:pointer">';
    var divProperti = variasi.kelasMedia;
    var inisial = esc((p.nama || "P").charAt(0).toUpperCase());
    if (p.gambar) {
      med +=
        '<img src="' + esc(p.gambar) + '" alt="' + esc(p.nama) + '" loading="lazy" class="' + divProperti + ' object-cover"' +
        ' onerror="this.style.display=\'none\';var p=this.nextElementSibling;if(p){p.style.display=\'flex\';}">';
      med += '<div class="' + divProperti + ' hidden items-center justify-center bg-accent-soft text-4xl font-bold text-accent" style="display:none">' + inisial + "</div>";
    } else {
      med += '<div class="' + divProperti + ' flex items-center justify-center bg-accent-soft text-4xl font-bold text-accent">' + inisial + "</div>";
    }
    med += lencanaStok(p);
    med += "</div>";
    return med;
  }

  function kartuProdukHTML(p, idx) {
    var harga = rupiah(hargaAngka(p.harga));
    var s = stokProduk(p);
    var tombol = s <= 0
      ? '<button type="button" class="btn btn-outline text-xs" disabled>Habis</button>'
      : '<button type="button" data-action="tambah-keranjang" data-id="' + idx + '" class="btn btn-primary px-3 py-2 text-xs">+ Keranjang</button>';
    return (
      '<article class="card flex flex-col overflow-hidden p-0">' +
      mediaProduk(p, { idx: idx, kelasMedia: "aspect-square w-full" }) +
      '  <div class="flex flex-1 flex-col gap-1.5 p-4">' +
      '    <span class="text-[11px] font-semibold uppercase tracking-wide text-accent">' + esc(p.kategori || "") + "</span>" +
      '    <h3 class="line-clamp-2 font-semibold leading-snug" data-action="detail-produk" data-id="' + idx + '" style="cursor:pointer">' + esc(p.nama) + "</h3>" +
      (p.deskripsi ? '<p class="line-clamp-2 text-xs leading-relaxed text-muted">' + esc(p.deskripsi) + "</p>" : "") +
      '    <div class="mt-auto flex items-center justify-between gap-2 pt-2">' +
      '      <span class="font-bold text-accent">' + harga + "</span>" +
      tombol +
      "    </div>" +
      "  </div>" +
      "</article>"
    );
  }

  /* =========================================================
     9) HALAMAN KERANJANG + CHECKOUT WHATSAPP
     ========================================================= */
  function htmlKeranjang() {
    var daftar = Object.keys(state.keranjang).map(function (k) {
      return { idx: parseInt(k, 10), qty: state.keranjang[k] };
    }).filter(function (item) {
      return state.produk[item.idx];
    });

    if (!daftar.length) {
      return (
        '<div class="mx-auto w-full max-w-6xl px-4 py-16">' +
        '  <h1 class="section-title text-center">Keranjang Belanja</h1>' +
        '  <div class="empty-state">' +
        '    <span class="text-5xl" aria-hidden="true">🛒</span>' +
        '    <p class="font-medium text-body">Keranjangmu masih kosong</p>' +
        '    <p class="text-sm text-muted">Yuk, pilih produk favoritmu dulu!</p>' +
        '    <a href="#/" data-action="nav" class="btn btn-primary mt-3">Jelajahi Produk</a>' +
        "  </div>" +
        "</div>"
      );
    }

    var baris = daftar.map(function (item) {
      var p = state.produk[item.idx];
      var sub = rupiah(hargaAngka(p.harga) * item.qty);
      var padaQty = item.qty;
      var inisial = esc((p.nama || "P").charAt(0).toUpperCase());
      var mediaThumb =
        '<div class="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-2">' +
        (p.gambar
          ? '<img src="' + esc(p.gambar) + '" alt="' + esc(p.nama) + '" class="h-full w-full object-cover"' +
            ' onerror="this.style.display=\'none\';var p=this.nextElementSibling;if(p){p.style.display=\'flex\';}">' +
            '<div class="absolute inset-0 hidden items-center justify-center bg-accent-soft text-xl font-bold text-accent" style="display:none">' + inisial + "</div>"
          : '<div class="absolute inset-0 flex items-center justify-center bg-accent-soft text-xl font-bold text-accent">' + inisial + "</div>") +
        "</div>";
      return (
        '<li class="flex gap-4 border-b border-app py-4 last:border-0">' +
        mediaThumb +
        '  <div class="flex min-w-0 flex-1 flex-col justify-between gap-2">' +
        '    <div class="flex items-start justify-between gap-2">' +
        '      <h3 class="line-clamp-2 text-sm font-semibold leading-snug">' + esc(p.nama) + "</h3>" +
        '      <button type="button" data-action="hapus-keranjang" data-id="' + item.idx + '" class="qty-btn shrink-0" aria-label="Hapus ' + esc(p.nama) + '">×</button>' +
        "    </div>" +
        '    <div class="flex items-center justify-between gap-2">' +
        '      <div class="flex items-center gap-2">' +
        '        <button type="button" class="qty-btn" data-action="minus-qty" data-id="' + item.idx + '" aria-label="Kurangi">−</button>' +
        '        <span class="min-w-6 text-center text-sm font-bold">' + padaQty + "</span>" +
        '        <button type="button" class="qty-btn" data-action="plus-qty" data-id="' + item.idx + '" aria-label="Tambah">+</button>' +
        "      </div>" +
        '      <span class="text-sm font-bold text-accent">' + sub + "</span>" +
        "    </div>" +
        "  </div>" +
        "</li>"
      );
    }).join("");

    var total = rupiah(totalKeranjang());

    return (
      '<div class="mx-auto w-full max-w-6xl px-4 py-10">' +
      '  <h1 class="section-title">Keranjang Belanja</h1>' +
      '  <p class="mt-1 text-sm text-muted">' + jumlahKeranjang() + " item — lengkapi data pesanan, kirim via WhatsApp</p>" +
      '  <div class="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">' +
      "    <div>" +
      '      <ul class="bg-surface px-4 shadow-sm sm:rounded-2xl sm:border sm:px-6">' +
      baris +
      "      </ul>" +
      "    </div>" +
      "    <aside class=\"h-fit lg:sticky lg:top-24\">" +
      '      <div class="card space-y-3 p-5">' +
      '        <h2 class="text-sm font-bold uppercase tracking-wide text-muted">Ringkasan</h2>' +
      '        <div class="flex justify-between text-sm text-body-2"><span>Subtotal</span><span>' + total + "</span></div>" +
      '        <div class="flex justify-between text-sm text-body-2"><span>Ongkir</span><span class="text-muted">Diskusi via WA</span></div>' +
      '        <div class="flex justify-between border-t border-app pt-3 text-base font-bold"><span>Total</span><span class="text-accent">' + total + "</span></div>" +
      "        <form id=\"form-pesan\" class=\"space-y-3\" novalidate>" +
      '          <input required name="nama" value="' + esc(state.formCache.nama || "") + '" class="input-app" placeholder="Nama kamu" autocomplete="name" />' +
      '          <textarea required name="alamat" rows="2" placeholder="Alamat pengiriman" autocomplete="street-address" class="input-app">' + esc(state.formCache.alamat || "") + "</textarea>" +
      '          <input name="catatan" value="' + esc(state.formCache.catatan || "") + '" class="input-app" placeholder="Catatan (opsional)" />' +
      '          <button type="submit" class="btn btn-primary w-full">Pesan via WhatsApp</button>' +
      "        </form>" +
      '        <button type="button" data-action="buka-qris" class="btn btn-outline w-full">Bayar via QRIS</button>' +
      "      </div>" +
      "    </aside>" +
      "  </div>" +
      "</div>"
    );
  }

  function kirimPesanan(e) {
    if (e) e.preventDefault();
    var form = $("#form-pesan");
    if (!form) return;

    var nama = form.elements["nama"] ? form.elements["nama"].value.trim() : "";
    var alamat = form.elements["alamat"] ? form.elements["alamat"].value.trim() : "";
    var catatan = form.elements["catatan"] ? form.elements["catatan"].value.trim() : "";

    if (!nama) { toast("Nama wajib diisi", "peringatan"); return; }
    if (!alamat) { toast("Alamat wajib diisi", "peringatan"); return; }
    if (!jumlahKeranjang()) { toast("Keranjang masih kosong", "peringatan"); return; }

    var baris = Object.keys(state.keranjang).map(function (k) {
      var idx = parseInt(k, 10);
      var p = state.produk[idx];
      return p
        ? (p.nama + "\n   " + state.keranjang[k] + " x " + rupiah(hargaAngka(p.harga)) +
           " = " + rupiah(hargaAngka(p.harga) * state.keranjang[k]))
        : "";
    }).filter(Boolean);

    var isi =
      "Halo *" + state.toko.nama_toko + "*,\nsaya ingin memesan:\n\n" +
      baris.join("\n") +
      "\n\n*Total: " + rupiah(totalKeranjang()) + "*\n\n" +
      "Nama: " + nama + "\nAlamat: " + alamat +
      (catatan ? "\nCatatan: " + catatan : "") +
      "\n\nMohon konfirmasi ketersediaan & ongkirnya ya. Terima kasih!";

    window.open(
      "https://wa.me/" + nomorWa(state.toko.whatsapp) + "?text=" + encodeURIComponent(isi),
      "_blank",
      "noopener"
    );
    toast("Mengarahkan ke WhatsApp…", "sukses");
  }

  /* =========================================================
     10) HALAMAN TENTANG
     ========================================================= */
  function htmlTentang() {
    var t = state.toko;
    return (
      '<div class="mx-auto w-full max-w-6xl px-4 py-10">' +
      '  <h1 class="section-title">Tentang Kami</h1>' +
      '  <div class="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">' +
      '    <div class="card overflow-hidden p-0">' +
      (t.foto_toko
        ? '<img src="' + esc(t.foto_toko) + '" alt="Foto ' + esc(t.nama_toko) + '" class="aspect-video w-full object-cover" onerror="this.style.display=\'none\'">'
        : '<div class="aspect-video w-full bg-accent-soft"></div>') +
      '      <div class="p-6">' +
      '        <h2 class="text-lg font-bold">' + esc(t.nama_toko) + "</h2>" +
      '        <p class="mt-2 text-sm leading-relaxed text-body-2">' + (t.deskripsi ? esc(t.deskripsi) : esc(t.tagline)) + "</p>" +
      "      </div>" +
      "    </div>" +
      '    <div class="space-y-4">' +
      (t.jam_operasional
        ? '      <div class="card p-5">' +
          '        <h3 class="text-sm font-bold uppercase tracking-wide text-muted">Jam Operasional</h3>' +
          '        <p class="mt-2 text-sm font-medium">' + esc(t.jam_operasional) + "</p>" +
          "      </div>"
        : "") +
      (t.alamat_toko
        ? '      <div class="card p-5">' +
          '        <h3 class="text-sm font-bold uppercase tracking-wide text-muted">Alamat</h3>' +
          '        <p class="mt-2 text-sm font-medium">' + esc(t.alamat_toko) + "</p>" +
          "      </div>"
        : "") +
      '      <div class="card p-5">' +
      '        <h3 class="text-sm font-bold uppercase tracking-wide text-muted">Kontak</h3>' +
      '        <div class="mt-3 flex flex-wrap gap-2">' +
      (t.whatsapp
        ? '<a href="https://wa.me/' + nomorWa(t.whatsapp) + '" target="_blank" rel="noopener" class="btn btn-primary">Pesan via WhatsApp</a>'
        : "") +
      (t.instagram
        ? '<a href="' + esc(t.instagram) + '" target="_blank" rel="noopener" class="btn btn-outline">' + esc(t.instagram_handle || "Instagram") + "</a>"
        : "") +
      "        </div>" +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</div>"
    );
  }

  /* =========================================================
     11) MODAL: DETAIL PRODUK & QRIS
     ========================================================= */
  function bukaModalProduk(idx) {
    var p = state.produk[idx];
    if (!p) return;

    var rute = ruteSekarang();
    if (rute.nama !== "produk" || rute.id !== idx) {
      window.location.hash = "#/produk/" + idx;
      return; // hashchange akan memanggil kembali fungsi ini
    }

    state.produkAktif = idx;
    state.modalQty = 1;

    var s = stokProduk(p);
    var media = p.gambar
      ? '<img src="' + esc(p.gambar) + '" alt="' + esc(p.nama) + '" class="aspect-square w-full object-cover" onerror="this.style.display=\'none\';var p=this.nextElementSibling;if(p){p.style.display=\'flex\';}">' +
        '<div class="aspect-square w-full hidden items-center justify-center bg-accent-soft" style="display:none">' +
        '  <span class="text-6xl font-bold text-accent">' + esc((p.nama || "P").charAt(0).toUpperCase()) + "</span></div>"
      : '<div class="flex aspect-square w-full items-center justify-center bg-accent-soft">' +
        '  <span class="text-6xl font-bold text-accent">' + esc((p.nama || "P").charAt(0).toUpperCase()) + "</span></div>";

    var statusStok = s <= 0
      ? '<span class="text-sm font-semibold" style="color:var(--danger)">Stok habis</span>'
      : '<span class="text-sm font-semibold" style="color:var(--success)">Stok tersedia: ' + s + "</span>";

    var kendaliQty =
      '<div class="flex items-center gap-3">' +
      '  <span class="text-sm text-muted">Jumlah</span>' +
      '  <div class="flex items-center gap-2">' +
      '    <button type="button" class="qty-btn" data-action="minus-modal" aria-label="Kurangi jumlah">−</button>' +
      '    <span id="modalQty" class="min-w-8 text-center text-base font-bold">1</span>' +
      '    <button type="button" class="qty-btn" data-action="plus-modal" aria-label="Tambah jumlah">+</button>' +
      "  </div>" +
      "</div>";

    var aksi = s <= 0
      ? '<button type="button" class="btn btn-outline w-full" disabled>Stok habis</button>'
      : kendaliQty +
        '<div class="flex flex-col gap-2 sm:flex-row">' +
        '  <button type="button" class="btn btn-outline flex-1" data-action="tambah-modal" data-id="' + idx + '">Tambah ke Keranjang</button>' +
        '  <button type="button" class="btn btn-primary flex-1" data-action="beli-sekarang" data-id="' + idx + '">Beli Sekarang</button>' +
        "</div>";

    $("#modal-panel").innerHTML =
      '<button type="button" class="modal-close" data-action="tutup-modal" aria-label="Tutup">×</button>' +
      '  <div class="md:grid md:grid-cols-2">' +
      "    <div class=\"relative\">" + media + "</div>" +
      '    <div class="flex flex-col gap-4 p-5 sm:p-6">' +
      '      <span class="text-xs font-semibold uppercase tracking-wide text-accent">' + esc(p.kategori || "") + "</span>" +
      '      <h2 class="text-xl font-bold leading-snug">' + esc(p.nama) + "</h2>" +
      '      <span class="text-2xl font-extrabold text-accent">' + rupiah(hargaAngka(p.harga)) + "</span>" +
      statusStok +
      (p.deskripsi ? '<p class="text-sm leading-relaxed text-body-2">' + esc(p.deskripsi) + "</p>" : "") +
      (p.unit ? '<p class="text-xs text-muted">Satuan: ' + esc(p.unit) + "</p>" : "") +
      '      <div class="mt-auto flex flex-col gap-3 pt-2">' + aksi + "</div>" +
      "    </div>" +
      "  </div>";

    tampilkanModal();
  }

  function bukaModalQris() {
    var qris = state.toko.qris;
    var dalam = qris
      ? '<img src="' + esc(qris) + '" alt="Kode QRIS" class="mx-auto aspect-square w-56 max-w-full rounded-2xl bg-surface" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
        '<div class="mx-auto hidden w-56 items-center justify-center rounded-2xl bg-surface-2 p-8 text-center" style="display:none">' +
        '  <p class="text-sm text-muted">Gambar QRIS belum tersedia.</p></div>'
      : '<div class="mx-auto flex max-w-xs items-center justify-center rounded-2xl bg-surface-2 p-8 text-center">' +
        '  <p class="text-sm text-muted">QRIS belum diunggah. Hubungi kami via WhatsApp untuk pembayaran.</p></div>';

    $("#modal-panel").innerHTML =
      '<button type="button" class="modal-close" data-action="tutup-modal" aria-label="Tutup">×</button>' +
      '  <div class="p-6 sm:p-8 text-center">' +
      '    <span class="text-4xl" aria-hidden="true">📱</span>' +
      '    <h2 class="mt-3 text-xl font-bold">Pembayaran QRIS</h2>' +
      '    <p class="mt-1 text-sm text-muted">Scan kode berikut dari aplikasi e-wallet / m-banking kamu.</p>' +
      '    <div class="mt-5">' + dalam + "</div>" +
      (state.toko.whatsapp
        ? '<a href="https://wa.me/' + nomorWa(state.toko.whatsapp) + '" target="_blank" rel="noopener" class="btn btn-primary mt-6 w-full">Konfirmasi via WhatsApp</a>'
        : '<button type="button" class="btn btn-primary mt-6 w-full" data-action="tutup-modal">Tutup</button>') +
      "  </div>";

    tampilkanModal();
  }

  function tampilkanModal() {
    var modal = $("#app-modal");
    modal.classList.add("modal-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    if ($("#tombolTema")) $("#tombolTema").blur();
  }

  function perbaruiModalQty() {
    var el = document.getElementById("modalQty");
    if (el) el.textContent = state.modalQty;
  }

  function tutupModal() {
    var modal = $("#app-modal");
    if (!modal) return;
    modal.classList.remove("modal-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    state.produkAktif = null;
  }

  /* =========================================================
     12) TOAST
     ========================================================= */
  function toast(pesan, nada) {
    var wadah = $("#app-toast");
    if (!wadah) return;
    var tip = document.createElement("div");
    tip.className = "toast toast-" + (nada || "info");
    tip.textContent = pesan;
    wadah.appendChild(tip);
    requestAnimationFrame(function () {
      tip.classList.add("toast-masuk");
    });
    setTimeout(function () {
      tip.classList.remove("toast-masuk");
      setTimeout(function () { tip.remove(); }, 300);
    }, 2600);
  }

  /* =========================================================
     13) EVENT (delegasi dokumen — sekali pasang, tahan re-render)
     ========================================================= */
  function toggleMenu() {
    var menu = $("#nav-mobile");
    if (menu) menu.classList.toggle("hidden");
  }

  document.addEventListener("click", function (e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;

    var aksi = target.getAttribute("data-action");

    switch (aksi) {
      case "nav":
        toggleMenu();
        return; // biarkan default anchor mengubah hash

      case "scroll-galeri": {
        var galeri = $("#app-galeri");
        if (galeri) galeri.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
      case "scroll-top":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;

      case "toggle-tema":
        toggleTema();
        break;
      case "toggle-menu":
        toggleMenu();
        break;

      case "detail-produk":
        bukaModalProduk(parseInt(target.getAttribute("data-id"), 10));
        break;
      case "tambah-keranjang":
        tambahKeranjang(parseInt(target.getAttribute("data-id"), 10), 1);
        break;
      case "tambah-modal":
        tambahKeranjang(parseInt(target.getAttribute("data-id"), 10), state.modalQty);
        break;
      case "beli-sekarang": {
        var idx = parseInt(target.getAttribute("data-id"), 10);
        tambahKeranjang(idx, state.modalQty, true);
        tutupModal();
        window.location.hash = "#/keranjang";
        break;
      }
      case "minus-modal":
        if (state.modalQty > 1) {
          state.modalQty--;
          perbaruiModalQty();
        }
        break;
      case "plus-modal": {
        var pMax = state.produk[state.produkAktif];
        var maks = pMax ? stokProduk(pMax) : 0;
        if (maks <= 0 || state.modalQty < maks) {
          state.modalQty++;
          perbaruiModalQty();
        }
        break;
      }
      case "minus-qty":
        ubahKuantitas(parseInt(target.getAttribute("data-id"), 10), -1);
        break;
      case "plus-qty":
        ubahKuantitas(parseInt(target.getAttribute("data-id"), 10), 1);
        break;
      case "hapus-keranjang":
        hapusKeranjang(parseInt(target.getAttribute("data-id"), 10));
        break;

      case "pilih-kategori": {
        var k = target.getAttribute("data-kategori");
        if (state.kategoriAktif !== k) {
          state.kategoriAktif = k;
          renderKategori();
          renderProduk();
        }
        break;
      }

      case "tutup-modal":
        tutupModal();
        if (ruteSekarang().nama === "produk") window.history.back();
        break;
      case "buka-qris":
        bukaModalQris();
        break;
    }

    e.preventDefault();
  });

  var perbaruiHasilCari = debounce(function () {
    renderProduk();
  }, 200);

  document.addEventListener("input", function (e) {
    if (e.target.closest("#form-pesan")) {
      state.formCache[e.target.name] = e.target.value;
    }
    if (!e.target.matches("[data-search]")) return;
    state.cari = e.target.value;
    if (history.replaceState) {
      history.replaceState(null, "", "#/cari?q=" + encodeURIComponent(state.cari));
    }
    perbaruiHasilCari();
  });

  document.addEventListener("change", function (e) {
    if (e.target.matches("select[data-urut]")) {
      state.urutan = e.target.value;
      renderProduk();
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target && e.target.id === "form-pesan") {
      e.preventDefault();
      kirimPesanan(e);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var modal = $("#app-modal");
      if (modal && modal.classList.contains("modal-open")) {
        tutupModal();
        if (ruteSekarang().nama === "produk") window.history.back();
      }
    }
  });

  window.addEventListener("hashchange", function () {
    if (!state.siap) return;
    muatHalaman();
  });

  window.addEventListener("scroll", function () {
    var btn = $("#scrollTop");
    if (!btn) return;
    if (window.scrollY > 300) btn.classList.add("show");
    else btn.classList.remove("show");
  });

  /* =========================================================
     14) BOOT
     ========================================================= */
  async function init() {
    await muatData();
    inisialisasiTema();
    isiKeranjang();
    renderBingkai();
    state.siap = true;
    muatHalaman();
    console.log("[MyToko] Engine v" + VERSION + " aktif — mesin CDN, data lokal toko.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);