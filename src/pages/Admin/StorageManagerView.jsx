import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import FadeIn from '../../components/FadeIn';

const StorageManagerView = () => {
  const [files, setFiles] = useState([]);
  const [groupedPendaftar, setGroupedPendaftar] = useState([]);
  const [orphanedFiles, setOrphanedFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Batas Storage Supabase Free Tier (1 GB dalam Bytes)
  const MAX_STORAGE_BYTES = 1073741824;

  // Helper format tanggal periode magang (sama seperti di PendaftarView)
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const options = { day: 'numeric', month: 'short', year: 'numeric' };
    return new Date(dateString).toLocaleDateString('id-ID', options);
  };

  // Helper untuk mengambil nama file asli dari URL Supabase Storage
  const extractFileName = (url) => {
    if (!url) return null;
    try {
      const cleanUrl = url.split('?')[0];
      return decodeURIComponent(cleanUrl.split('/').pop());
    } catch {
      return url.split('/').pop();
    }
  };

  const fetchStorageAndPendaftar = async () => {
    setIsLoading(true);
    try {
      // 1. Ambil semua file dari bucket 'berkas_pendaftar'
      const { data: storageData, error: storageError } = await supabase.storage
        .from('berkas_pendaftar')
        .list('', {
          limit: 1000,
          offset: 0,
          sortBy: { column: 'created_at', order: 'desc' },
        });

      if (storageError) throw storageError;

      const validFiles = (storageData || []).filter(
        (file) => file.name !== '.emptyFolderPlaceholder'
      );
      setFiles(validFiles);

      // Map cepat: nama_file -> objek metadata file
      const storageMap = new Map();
      validFiles.forEach((f) => storageMap.set(f.name, f));

      // 2. Ambil data pendaftar beserta periode magang & kolom URL berkasnya
      const { data: pendaftarData, error: pendaftarError } = await supabase
        .from('pendaftaran')
        .select(`
          id,
          nama_peserta,
          asal_sekolah_kampus,
          nim_nisn,
          tanggal_mulai,
          tanggal_akhir,
          status_seleksi,
          berkas_ktm,
          berkas_pdf,
          berkas_cv,
          berkas_portofolio,
          bukti_ig,
          bukti_fb,
          bukti_tt,
          bukti_yt
        `)
        .order('created_at', { ascending: false });

      if (pendaftarError) throw pendaftarError;

      const matchedFileNames = new Set();
      const kelompokList = [];

      // 3. Cocokkan berkas milik masing-masing pendaftar dengan file aktif di Storage
      (pendaftarData || []).forEach((peserta) => {
        const berkasMapping = [
          { key: 'berkas_ktm', url: peserta.berkas_ktm },
          { key: 'berkas_pdf', url: peserta.berkas_pdf },
          { key: 'berkas_cv', url: peserta.berkas_cv },
          { key: 'berkas_portofolio', url: peserta.berkas_portofolio },
          { key: 'bukti_ig', url: peserta.bukti_ig },
          { key: 'bukti_fb', url: peserta.bukti_fb },
          { key: 'bukti_tt', url: peserta.bukti_tt },
          { key: 'bukti_yt', url: peserta.bukti_yt },
        ];

        const activeFiles = [];
        let groupSizeBytes = 0;

        berkasMapping.forEach((item) => {
          const fName = extractFileName(item.url);
          if (fName && storageMap.has(fName)) {
            const fileMeta = storageMap.get(fName);
            activeFiles.push(fName);
            groupSizeBytes += fileMeta.metadata?.size || 0;
            matchedFileNames.add(fName);
          }
        });

        if (activeFiles.length > 0) {
          kelompokList.push({
            ...peserta,
            activeFiles,
            totalSize: groupSizeBytes,
          });
        }
      });

      // 4. Cari file yatim (ada di Storage tapi tidak tercatat di pendaftar mana pun)
      const sisaFiles = validFiles.filter((f) => !matchedFileNames.has(f.name));

      setGroupedPendaftar(kelompokList);
      setOrphanedFiles(sisaFiles);
    } catch (error) {
      console.error('Gagal memuat data:', error);
      alert(`Gagal memuat data Storage: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStorageAndPendaftar();
  }, []);

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // --- KALKULASI PENGGUNAAN STORAGE ---
  const totalUsedBytes = files.reduce((acc, file) => acc + (file.metadata?.size || 0), 0);
  const usedPercentage = Math.min((totalUsedBytes / MAX_STORAGE_BYTES) * 100, 100).toFixed(2);
  const progressColor =
    usedPercentage > 85 ? 'bg-red-500' : usedPercentage > 60 ? 'bg-amber-500' : 'bg-blue-500';

  // --- BUKA / DOWNLOAD FILE ---
  const handleOpenFile = (fileUrl) => {
    if (!fileUrl) return alert('File tidak tersedia.');
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  // --- BUKA FILE YATIM DARI PUBLIC URL BUCKET ---
  const handleOpenOrphanFile = (fileName) => {
    const { data } = supabase.storage.from('berkas_pendaftar').getPublicUrl(fileName);
    if (data?.publicUrl) {
      window.open(data.publicUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // --- HAPUS SEMUA BERKAS MILIK 1 KELOMPOK PENDAFTAR ---
  const handleDeleteGroup = async (peserta) => {
    if (peserta.status_seleksi === 'pending') {
      return alert('Berkas peserta dengan status PENDING tidak dapat dihapus sebelum diseleksi.');
    }

    const jumlahFile = peserta.activeFiles.length;
    if (jumlahFile === 0) return alert('Tidak ada berkas aktif di Storage untuk peserta ini.');

    const konfirmasi = window.confirm(
      `Yakin ingin menghapus seluruh (${jumlahFile}) berkas milik "${peserta.nama_peserta}" dari Storage?\n\nUkuran dibebaskan: ${formatBytes(peserta.totalSize)}`
    );
    if (!konfirmasi) return;

    setIsDeleting(true);
    try {
      // 1. Hapus file fisik dari bucket Storage
      const { error: storageError } = await supabase.storage
        .from('berkas_pendaftar')
        .remove(peserta.activeFiles);

      if (storageError) throw storageError;

      // 2. Kosongkan kolom URL berkas di tabel pendaftaran agar tidak jadi broken link
      const { error: dbError } = await supabase
        .from('pendaftaran')
        .update({
          berkas_ktm: null,
          berkas_pdf: null,
          berkas_cv: null,
          berkas_portofolio: null,
          bukti_ig: null,
          bukti_fb: null,
          bukti_tt: null,
          bukti_yt: null,
        })
        .eq('id', peserta.id);

      if (dbError) throw dbError;

      alert(`Berhasil membersihkan ${jumlahFile} berkas milik ${peserta.nama_peserta}!`);
      fetchStorageAndPendaftar();
    } catch (error) {
      alert(`Gagal menghapus berkas kelompok: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- HAPUS SEMUA FILE YATIM (ORPHANED) ---
  const handleDeleteAllOrphaned = async () => {
    if (orphanedFiles.length === 0) return;
    if (
      !window.confirm(
        `Hapus semua (${orphanedFiles.length}) berkas tanpa data pendaftar ini?`
      )
    )
      return;

    setIsDeleting(true);
    try {
      const fileNames = orphanedFiles.map((f) => f.name);
      const { error } = await supabase.storage.from('berkas_pendaftar').remove(fileNames);
      if (error) throw error;

      alert('Berkas tanpa pendaftar berhasil dibersihkan!');
      fetchStorageAndPendaftar();
    } catch (error) {
      alert(`Gagal menghapus berkas: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- HAPUS SELURUH BUCKET ---
  const handleDeleteAll = async () => {
    if (files.length === 0) return alert('Storage sudah kosong.');

    const confirm1 = window.confirm(
      'PERINGATAN KRITIS: Anda yakin ingin menghapus SEMUA BERKAS di Storage (termasuk peserta yang masih pending)?'
    );
    if (!confirm1) return;

    const confirm2 = window.confirm(
      'Apakah Anda benar-benar yakin? Tindakan ini akan menghapus seluruh file dari bucket berkas_pendaftar.'
    );
    if (!confirm2) return;

    setIsDeleting(true);
    try {
      const fileNames = files.map((f) => f.name);
      const { error } = await supabase.storage.from('berkas_pendaftar').remove(fileNames);
      if (error) throw error;

      alert('BERHASIL: Semua berkas telah dibersihkan dari Storage!');
      fetchStorageAndPendaftar();
    } catch (error) {
      alert(`Gagal menghapus semua file: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 md:p-10">
      <FadeIn>
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Manajemen Storage</h1>
            <p className="text-slate-500 text-sm mt-1">
              Berkas dikelompokkan berdasarkan nama pendaftar. Peserta berstatus pending terkunci otomatis agar berkas aman selama seleksi.
            </p>
          </div>

          <button
            onClick={handleDeleteAll}
            disabled={isDeleting || files.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded shadow disabled:opacity-50 transition"
          >
            {isDeleting ? 'Memproses...' : '🗑️ Hapus Semua Berkas'}
          </button>
        </div>

        {/* --- INDIKATOR KAPASITAS STORAGE --- */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm mb-6">
          <div className="flex justify-between text-sm font-bold text-slate-700 mb-2">
            <span>Kapasitas Bucket Terpakai (Limit Free: 1 GB)</span>
            <span className={usedPercentage > 85 ? 'text-red-600' : ''}>{usedPercentage}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden border border-slate-200">
            <div
              className={`h-4 transition-all duration-500 ease-in-out ${progressColor}`}
              style={{ width: `${usedPercentage}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
            <span>
              Terpakai: {formatBytes(totalUsedBytes)} ({files.length} total file)
            </span>
            <span>Sisa: {formatBytes(MAX_STORAGE_BYTES - totalUsedBytes)}</span>
          </div>
        </div>

        {/* --- TABEL KELOMPOK BERKAS PER PENDAFTAR --- */}
        <div className="admin-table-box bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
          {isLoading ? (
            <div className="p-10 text-center text-slate-500 font-bold">
              Memuat & mengelompokkan berkas dari Storage...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="admin-th">Nama & Asal</th>
                    <th className="admin-th">NIM/NISN</th>
                    <th className="admin-th">Periode Magang</th>
                    <th className="admin-th">Status</th>
                    <th className="admin-th">Total Ukuran</th>
                    <th className="admin-th text-center">Berkas Utama</th>
                    <th className="admin-th text-center">Bukti Sosmed</th>
                    <th className="admin-th text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {groupedPendaftar.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-6 py-10 text-center text-slate-500 italic">
                        Tidak ada berkas pendaftar yang tersimpan di Storage.
                      </td>
                    </tr>
                  ) : (
                    groupedPendaftar.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800">{row.nama_peserta}</p>
                          <p className="text-xs text-slate-500">{row.asal_sekolah_kampus}</p>
                        </td>

                        <td className="px-6 py-4 text-slate-600">{row.nim_nisn}</td>

                        {/* PERIODE MAGANG */}
                        <td className="px-6 py-4">
                          <span className="block text-xs font-bold text-slate-700">
                            {formatDate(row.tanggal_mulai)}
                          </span>
                          <span className="block text-xs text-slate-500">
                            s.d. {formatDate(row.tanggal_akhir)}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize ${row.status_seleksi === 'diterima'
                                ? 'bg-emerald-100 text-emerald-700'
                                : row.status_seleksi === 'ditolak'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                          >
                            {row.status_seleksi || 'pending'}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700 block">
                            {formatBytes(row.totalSize)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {row.activeFiles.length} file di storage
                          </span>
                        </td>

                        {/* BERKAS UTAMA */}
                        <td className="px-6 py-4 text-center">
                          <div className="grid grid-cols-2 gap-1 items-center justify-center">
                            {row.berkas_ktm && (
                              <button
                                onClick={() => handleOpenFile(row.berkas_ktm)}
                                className="admin-btn-dl w-full text-[10px] py-1"
                                title="Lihat / Download KTM"
                              >
                                KTM
                              </button>
                            )}
                            {row.berkas_pdf && (
                              <button
                                onClick={() => handleOpenFile(row.berkas_pdf)}
                                className="admin-btn-dl w-full text-[10px] py-1"
                                title="Lihat / Download Surat"
                              >
                                Surat
                              </button>
                            )}
                            {row.berkas_cv && (
                              <button
                                onClick={() => handleOpenFile(row.berkas_cv)}
                                className="admin-btn-dl w-full text-[10px] py-1"
                                title="Lihat / Download CV"
                              >
                                CV
                              </button>
                            )}
                            {row.berkas_portofolio && (
                              <button
                                onClick={() => handleOpenFile(row.berkas_portofolio)}
                                className="admin-btn-dl w-full text-[10px] py-1"
                                title="Lihat / Download Portofolio"
                              >
                                Porto
                              </button>
                            )}
                          </div>
                        </td>

                        {/* BUKTI SOSMED */}
                        <td className="px-6 py-4 text-center">
                          <div className="grid grid-cols-2 gap-1 items-center justify-center">
                            {row.bukti_ig && (
                              <button
                                onClick={() => handleOpenFile(row.bukti_ig)}
                                className="bg-pink-100 text-pink-700 hover:bg-pink-600 hover:text-white rounded text-[10px] py-1 px-2 font-bold transition"
                                title="Lihat / Download Bukti IG"
                              >
                                IG
                              </button>
                            )}
                            {row.bukti_fb && (
                              <button
                                onClick={() => handleOpenFile(row.bukti_fb)}
                                className="bg-blue-100 text-blue-700 hover:bg-blue-600 hover:text-white rounded text-[10px] py-1 px-2 font-bold transition"
                                title="Lihat / Download Bukti FB"
                              >
                                FB
                              </button>
                            )}
                            {row.bukti_tt && (
                              <button
                                onClick={() => handleOpenFile(row.bukti_tt)}
                                className="bg-slate-200 text-slate-800 hover:bg-slate-800 hover:text-white rounded text-[10px] py-1 px-2 font-bold transition"
                                title="Lihat / Download Bukti TikTok"
                              >
                                TT
                              </button>
                            )}
                            {row.bukti_yt && (
                              <button
                                onClick={() => handleOpenFile(row.bukti_yt)}
                                className="bg-red-100 text-red-700 hover:bg-red-600 hover:text-white rounded text-[10px] py-1 px-2 font-bold transition"
                                title="Lihat / Download Bukti YouTube"
                              >
                                YT
                              </button>
                            )}
                          </div>
                        </td>

                        {/* AKSI: TERKUNCI JIKA PENDING, BISA DIHAPUS JIKA SUDAH DISELEKSI */}
                        <td className="px-6 py-4 text-center">
                          {row.status_seleksi === 'pending' ? (
                            <span
                              className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded font-medium inline-block cursor-not-allowed"
                              title="Seleksi peserta ini di halaman Pendaftar terlebih dahulu sebelum menghapus berkasnya"
                            >
                              🔒 Menunggu Seleksi
                            </span>
                          ) : (
                            <button
                              onClick={() => handleDeleteGroup(row)}
                              disabled={isDeleting}
                              className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 hover:border-red-600 font-bold text-xs px-3 py-2 rounded transition disabled:opacity-50"
                            >
                              🗑️ Hapus Berkas ({row.activeFiles.length})
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* --- BAGIAN BERKAS YATIM / ORPHANED --- */}
        {!isLoading && orphanedFiles.length > 0 && (
          <div className="bg-amber-50/60 rounded-xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="px-6 py-4 bg-amber-100/70 border-b border-amber-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="font-bold text-amber-900 text-base">
                  Berkas Tanpa Data Pendaftar ({orphanedFiles.length} file)
                </h2>
                <p className="text-xs text-amber-700">
                  File ini berada di Storage namun tidak terhubung dengan data pendaftar mana pun di database.
                </p>
              </div>
              <button
                onClick={handleDeleteAllOrphaned}
                disabled={isDeleting}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-2 rounded shadow-sm transition disabled:opacity-50"
              >
                🗑️ Bersihkan Semua Sisa File
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-amber-50 text-amber-900 text-xs uppercase">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Nama File</th>
                    <th className="px-6 py-3 font-semibold">Ukuran</th>
                    <th className="px-6 py-3 font-semibold">Tgl Diupload</th>
                    <th className="px-6 py-3 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="text-sm bg-white">
                  {orphanedFiles.map((file) => (
                    <tr key={file.id} className="border-t border-amber-100 hover:bg-amber-50/40">
                      <td className="px-6 py-3 max-w-xs truncate font-medium text-slate-700">
                        <button
                          onClick={() => handleOpenOrphanFile(file.name)}
                          className="text-blue-600 hover:underline text-left truncate max-w-xs"
                          title="Klik untuk lihat / download"
                        >
                          {file.name}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {formatBytes(file.metadata?.size)}
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {new Date(file.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Hapus file "${file.name}"?`)) return;
                            setIsDeleting(true);
                            await supabase.storage.from('berkas_pendaftar').remove([file.name]);
                            setIsDeleting(false);
                            fetchStorageAndPendaftar();
                          }}
                          disabled={isDeleting}
                          className="text-red-600 hover:text-red-800 font-bold text-xs bg-red-50 hover:bg-red-100 px-3 py-1 rounded transition"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </FadeIn>
    </div>
  );
};

export default StorageManagerView;