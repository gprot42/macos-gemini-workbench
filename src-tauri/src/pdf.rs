use std::path::PathBuf;
use std::time::Duration;

/// Render the main webview with print CSS (only #print-root visible) straight to a PDF file.
/// Uses an NSPrintOperation with a save-to-file disposition, so no print dialog is shown.
#[cfg(target_os = "macos")]
pub async fn save_webview_pdf(webview: tauri::Webview, path: String) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{NSString, NSURL};
    use objc2_web_kit::WKWebView;

    let out = PathBuf::from(&path);
    if out.exists() {
        std::fs::remove_file(&out).map_err(|e| format!("Failed to replace file: {}", e))?;
    }

    webview
        .with_webview(move |platform| unsafe {
            let wk: &WKWebView = &*(platform.inner() as *const WKWebView);
            let window: &NSWindow = &*(platform.ns_window() as *const NSWindow);

            let info = NSPrintInfo::new();
            info.setJobDisposition(NSPrintSaveJob);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            info.dictionary()
                .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
            info.setTopMargin(36.0);
            info.setBottomMargin(36.0);
            info.setLeftMargin(36.0);
            info.setRightMargin(36.0);
            info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
            info.setVerticallyCentered(false);

            let operation = wk.printOperationWithPrintInfo(&info);
            operation.setShowsPrintPanel(false);
            operation.setShowsProgressPanel(false);
            // WKWebView only renders print output when run against its window.
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                None,
                None,
                std::ptr::null_mut(),
            );
        })
        .map_err(|e| format!("Failed to access webview: {}", e))?;

    // The operation runs asynchronously on the main thread; wait for the file to finish writing.
    let mut last_size = None;
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Ok(meta) = std::fs::metadata(&out) {
            let size = meta.len();
            if size > 0 && last_size == Some(size) {
                return Ok(());
            }
            last_size = Some(size);
        }
    }
    Err("Timed out waiting for the PDF to be written".to_string())
}

#[cfg(not(target_os = "macos"))]
pub async fn save_webview_pdf(_webview: tauri::Webview, _path: String) -> Result<(), String> {
    Err("Saving PDF is only supported on macOS".to_string())
}
