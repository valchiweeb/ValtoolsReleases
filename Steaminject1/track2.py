import time
import datetime
import win32clipboard
import win32con
import pywintypes # Penting untuk menangkap error Windows spesifik

def get_clipboard_content_robust():
    """
    Mencoba membaca clipboard dengan mekanisme RETRY.
    Jika gagal (Access Denied), dia akan mencoba lagi hingga 5x 
    dalam waktu singkat sebelum menyerah.
    """
    max_retries = 5
    
    for attempt in range(max_retries):
        try:
            win32clipboard.OpenClipboard()
            
            content_type = None
            content_data = None

            # 1. Prioritas: Cek File (CF_HDROP)
            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_HDROP):
                content_data = win32clipboard.GetClipboardData(win32clipboard.CF_HDROP)
                content_type = "FILE"
            
            # 2. Cek Teks (CF_UNICODETEXT)
            elif win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                content_data = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
                content_type = "TEXT"
            
            # 3. Cek Bitmap/Gambar (Sekedar tahu tipe, tidak ambil datanya krn berat)
            elif win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_BITMAP) or \
                 win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_DIB):
                content_type = "IMAGE/MEDIA"
                content_data = "[Gambar/Media terdeteksi]"

            win32clipboard.CloseClipboard()
            return content_type, content_data

        except pywintypes.error as e:
            # Jika errornya "Access Denied" (biasanya kode 5 atau 1418), kita coba lagi
            # Jangan panik, tunggu 0.1 detik lalu loop lagi
            time.sleep(0.1)
            continue
            
        except Exception as e:
            # Error lain yang tidak terduga
            try: win32clipboard.CloseClipboard()
            except: pass
            return None, None
            
    # Jika sudah 5x coba tetap gagal:
    return None, None

def monitor_robust():
    print("[*] Robust Clipboard Monitor (High Precision)...")
    print("[*] Mencatat: File, Teks, dan Gambar.")
    print("-" * 60)

    last_data = None # Simpan data terakhir biar gak spam log

    try:
        while True:
            # Panggil fungsi pembaca yang "gigih" tadi
            ctype, cdata = get_clipboard_content_robust()

            # Logika pencatatan
            if cdata and cdata != last_data:
                timestamp = datetime.datetime.now().strftime("%H:%M:%S")
                
                print(f"[BARU] {timestamp} | Tipe: {ctype}")
                
                if ctype == "FILE":
                    print(f"Jumlah: {len(cdata)} file")
                    # Tampilkan max 3 file saja biar layar gak penuh
                    for path in cdata[:3]: 
                        print(f" -> {path}")
                    if len(cdata) > 3: print(" -> ... (dan lainnya)")
                        
                elif ctype == "TEXT":
                    # Bersihkan enter/spasi berlebih
                    clean_txt = cdata.strip().replace('\r', '').replace('\n', ' ')
                    preview = clean_txt[:80] + "..." if len(clean_txt) > 80 else clean_txt
                    print(f"Isi: {preview}")
                    
                else:
                    print(f"Info: {cdata}")

                print("-" * 60)
                last_data = cdata

            # Sleep dipercepat jadi 0.2 detik (Respon lebih kilat)
            time.sleep(0.2)

    except KeyboardInterrupt:
        print("\n[*] Monitoring berhenti.")

if __name__ == "__main__":
    monitor_robust()