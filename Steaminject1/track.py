import time
import sys
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class NewFileHandler(FileSystemEventHandler):
    def on_created(self, event):
        # Fungsi ini akan jalan OTOMATIS saat ada file/folder baru
        if not event.is_directory:
            message = f"[BARU] File terdeteksi: {event.src_path}"
            print(message)
            
            # Simpan ke log file (history)
            with open("history_file_masuk.txt", "a") as f:
                f.write(f"{time.ctime()} - {message}\n")

    def on_modified(self, event):
        # Opsional: Jika ingin tahu file yang diedit/berubah
        pass

    def on_deleted(self, event):
        # Opsional: Jika ingin tahu file yang dihapus
        if not event.is_directory:
            print(f"[HAPUS] File hilang: {event.src_path}")

if __name__ == "__main__":
    # Tentukan folder yang mau dipantau
    # Ganti "." dengan path spesifik, misal: "C:/Users/Administrator/Downloads"
    path_to_watch = "C:\Program Files (x86)\Steam" 

    print(f"[*] Sedang memantau folder: {path_to_watch}")
    print("[*] Tekan Ctrl+C untuk berhenti...")

    event_handler = NewFileHandler()
    observer = Observer()
    observer.schedule(event_handler, path_to_watch, recursive=True)
    
    # Start Monitoring
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()